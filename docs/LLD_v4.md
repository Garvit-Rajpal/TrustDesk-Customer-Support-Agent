# TrustDesk — LLD v4

**Version:** 4.0 · **Extends:** `LLD_v3.md` · **Parent:** `HLD_v4.md` · TDD methodology (LLD v1 §1) applies unchanged to every v4 milestone.

Delta document: only new/changed contracts appear here.

---

## 1. Schema Changes

Two migrations, split because W15's needs the `pgvector/pgvector:pg16`
image (docker-compose.yml swap) and the rest are ordinary additive
migrations. **Correction during W15 implementation:** the image swap does
NOT require recreating the local Docker volume — `pgvector/pgvector:pg16`
is Postgres 16 plus the `vector` extension's shared library, on-disk-format
compatible with a volume that was initialized under plain `postgres:16`;
swap the image, restart, and the migration below just works against
existing data.

```sql
-- W15: requires the pgvector/pgvector:pg16 image (docker-compose.yml swap
-- from postgres:16 — same Postgres 16 on-disk format, existing local
-- volumes keep working unmodified).
CREATE EXTENSION IF NOT EXISTS vector;

-- W15: one row per (org, ticket, sent draft) resolution actually embedded.
-- emb_ prefix per CLAUDE.md ID conventions (new prefix, added to ids.ts).
CREATE TABLE ticket_resolution_embeddings (
  embedding_id  text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES orgs,
  ticket_id     text NOT NULL,
  draft_id      text NOT NULL,
  category      text NOT NULL,
  resolution_type text NOT NULL,
  source_text   text NOT NULL,
  embedding     vector(768) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ticket_resolution_embeddings (org_id);
CREATE INDEX ON ticket_resolution_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

```sql
-- W16: per-org policy-pack rule layer needs no new column — rules live in
-- src/policy_packs/{vertical}/guardrail_rules.json, read at request time,
-- same pattern the existing tool_catalog policy-pack stamping already uses.
-- No schema change for W16 at all: new GuardrailResult rows use the
-- existing agent_runs.guardrail_results jsonb array (invariant #6), just
-- with new `layer`/`check` values (see §5 below) — additive by construction,
-- no ALTER needed since that column was never enum-constrained beyond the
-- GuardrailResult zod schema, which IS changed (see §5).

-- W14: extend run_events' stage CHECK constraint (additive) to admit the
-- new "eval_case" PipelineStage value.
ALTER TABLE run_events DROP CONSTRAINT run_events_stage_check;
ALTER TABLE run_events ADD CONSTRAINT run_events_stage_check
  CHECK (stage IN ('input_scan','triage','retrieval','eligibility',
                    'draft_generation','output_scan','eval_case'));

-- W16: ExecuteOutcome gains a new "guardrail_blocked" kind — no schema
-- change needed, tool_actions.status stays unchanged (a blocked execution
-- attempt is reported to the caller but the action row stays "approved",
-- eligible for a retry once the blocking condition clears — same shape as
-- an "illegal_transition" outcome today, which also writes nothing).
```

No schema change is needed for W12 (`orders`/`customers` seed data content
only — `customer_id` FK already permits many orders per customer), W13
(display-layer only), or W17's identity/transport layer (`CustomerToken` is
a signed JWT claim shape, not a DB row — see §6 below; `ticket_messages`
needs no new column since a customer-authored inbound message is
structurally identical to today's `simulateInbound()` row).

---

## 2. W12 — Dummy Data Enrichment

`data/customers.json` (6 seed customers, unchanged) /
`data/orders.json` expanded from 6 to ~20-25 orders, distributed across all
6 customers with varied `status`/`items`/`placed_at`/`payment_status`. The
existing `ord_5001`-`ord_5006` rows keep their exact current field values —
`data/eval_cases.jsonl` and the eligibility test suite (`eligibility.ts`
tests) assert against them by ID and by field. New order IDs follow the
same `ord_5NNN` numeric-seed convention, continuing past `ord_5006`
(`ord_5007`...`ord_5030`), not the runtime `nanoid()` convention — these
are seed-loader rows, same category as the existing six, not
runtime-created via `newTicketId()`-style generation.

**`listOrdersByCustomerId(ctx, customerId): Promise<Order[]>`** (new,
`src/db/repos/ordersRepo.ts`): `SELECT ... FROM orders WHERE customer_id =
$1 AND org_id = $2 ORDER BY placed_at DESC`.

**`GET /customers/:id/orders`** (`customers:view`, same permission tier as
the existing `GET /customers`): new route in
`src/api/routes/customers.ts`. 404 if the customer doesn't exist in the
caller's org (reuses `getCustomerById()`'s existing org-scoping); otherwise
`{ data: { orders: Order[] } }`.

---

## 3. W13 — Ticket Detail: JSON→Table + Order History

**`listCustomerOrders(customerId): Promise<Order[]>`** (new,
`frontend/src/api.ts`): calls the W12 endpoint above.

**New `frontend/src/design-system/CustomerCard.tsx`**: renders
`Customer` (name, email, tier badge, country, verified badge, tags) as a
labeled card, following `StatusBadge.tsx`'s existing badge-coloring
convention for `tier`/`verified`.

**New `frontend/src/design-system/OrderCard.tsx`**: renders one `Order`
(status, placed/delivered dates, total+currency, payment status, tracking
number) plus its `items: OrderItem[]` via the existing `DataTable.tsx`
(columns: sku, name, quantity, category, final_sale).

**New order-history section** in `TicketView.tsx`: below the current
order's `OrderCard`, a collapsed-by-default list of the customer's other
orders (via `listCustomerOrders()`), each rendered as a compact `OrderCard`
row, giving an agent quick context on the customer's history without
leaving the ticket.

**Changed:** `TicketView.tsx:248-257` — the two
`<pre>{JSON.stringify(customer)}</pre>` / `<pre>{JSON.stringify(order)}</pre>`
blocks are replaced by `<CustomerCard customer={customer} />` and
`<OrderCard order={order} />`. `ActionPanel.tsx` is unchanged — it consumes
`order`/`customer` in the same shape the API has always returned.

**Milestone:** manual browser QA only (no frontend test runner exists in
this repo — the same v1-v3 convention).

---

## 4. W14 — Eval-Run Streaming Progress

**`PipelineStage`** (`src/domain/schemas.ts`) gains a new enum value,
`"eval_case"`, alongside the existing six. `EventSummary` gains no new
fields — an eval-case event's summary reuses the existing optional
`category`/`resolution_type`/`counts` fields (`counts: {index, total}`
reports "case 3 of 9").

**`runEvalSet()`** (`src/services/evalRunner.ts`, changed): `newEvalRunId()`
moves to the top of the function (previously generated only when
`insertEvalRun()` was called at the end), so an ID exists before any case
runs. Around each `runOneCase()` call, emit
`pipelineEventBus.emitStage(evalRunId, "eval_case", "started", {case_id,
counts: {index, total}})` and the matching `"completed"`/`"failed"` event
after. The loop itself, and every call it makes to `runTriage()`/
`generateDraft()`, is unchanged — this is purely an observability layer.

**`POST /eval-runs/start`** (`eval_runs:run`, new): no request body. Mints
an `eval_run_id` via `newEvalRunId()` and returns
`{ data: { eval_run_id } }` synchronously with no side effects beyond
minting the ID — nothing is persisted yet (`insertEvalRun()` still only
happens once the run completes, as today).

**`RunEvalRequest`** (`src/domain/evalRunTypes.ts`, changed): gains an
optional `eval_run_id: z.string().optional()`. **`runEvalSet()`** accepts
an optional pre-minted ID and uses it instead of generating its own when
present — the client flow becomes: `POST /eval-runs/start` → open
`EventSource` on `GET /eval-runs/:runId/events` → `POST /eval-runs
{eval_run_id, case_ids?}`.

**`GET /eval-runs/:runId/events`** (`runs:view`, new): near-verbatim mirror
of the existing `GET /tickets/:id/runs/:runId/events` (`tickets.ts`) minus
the ticket-ownership lookup (an eval run has no `ticket_id`) — replay
persisted `run_events` for the ID, then, if no terminal event has been
recorded, subscribe to `pipelineEventBus` and stream live until a terminal
`eval_case`/run-level event closes the connection. Because
`runEvalSet()` still executes synchronously start-to-finish inside a single
request (unchanged, per ADR-20's reasoning), a client opening the SSE
stream immediately after `POST /eval-runs/start` will, in practice, always
hit the live-subscription path rather than the replay path — the reverse
of the single-ticket case, where synchronous completion usually means only
the replay path is exercised. Both paths are still implemented and tested,
since a slow-to-connect or reconnecting client can land on either.

**Frontend:** new `frontend/src/components/EvalRunStepper.tsx`
(parameterized off the existing `RunStepper.tsx`, rendering "Case 3 of 9:
tkt_9003 — draft_generation started…"), wired into `EvalReport.tsx` in
place of the current static "Running…" text. A static rotating-copy array
(no new dependency) cycles engaging status lines ("Checking guardrails…",
"Scoring against expected labels…") while a case is in flight, keyed off
the current stage from the stepper.

---

## 5. W15 — pgvector Similarity Ingestion

**`docker-compose.yml`**: `image: postgres:16` → `image:
pgvector/pgvector:pg16` (same user/db/volume config, unchanged). **Verified
during implementation:** the existing `trustdesk_pg_data` volume does not
need recreating — `pgvector/pgvector:pg16` is Postgres 16 plus the `vector`
extension, on-disk-format compatible with a volume already initialized
under plain `postgres:16`. Swap the image, `docker compose up` restarts
against the same volume, and the migration below runs normally.

**Migration**: see §1 above — `CREATE EXTENSION vector` +
`ticket_resolution_embeddings` table, `emb_` prefixed IDs
(`newEmbeddingId()`, new export in `ids.ts`).

**`src/adapters/embeddingAdapter.ts`** (new interface, mirrors
`modelAdapter.ts`'s shape):

```ts
export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
}
```

**`src/adapters/mockEmbedding.ts`** (new, used in every test per LLD v1
§1's `MockModelAdapter`-in-tests rule, extended to embeddings): a
deterministic fake — hashes the input text to a fixed-length numeric seed,
producing a stable 768-dimension vector for the same input every time (so
similarity-ordering tests are deterministic), distinct vectors for distinct
inputs.

**`src/adapters/createEmbeddingAdapter.ts`** (new, mirrors
`createModelAdapter.ts`'s `resolveModelTier()`/factory pattern exactly):
`EMBEDDING_TIER=mock|local|hosted` (falls back to `mock` if unset, mirroring
`resolveModelTier()`'s conservative default). `local` calls Ollama's
OpenAI-compatible `/v1/embeddings` endpoint with an embedding-capable model
(default `nomic-embed-text`, override via `EMBEDDING_MODEL_NAME`) at
`OPENAI_BASE_URL_LOCAL` (reused, same Ollama instance chat completions
already use). `hosted` calls a purchased embeddings API using a new,
**distinct** `EMBEDDINGS_API_KEY` / `EMBEDDINGS_BASE_URL` pair — never the
existing `OPENAI_API_KEY`, which points at OpenRouter (no embeddings
endpoint) per this project's own `.env` convention.

**`src/db/repos/resolutionEmbeddingsRepo.ts`** (new):
`insertResolutionEmbedding(ctx, row)`, and
`findSimilarResolutions(ctx, queryEmbedding, category?, limit=3)` — raw SQL
using the `<=>` cosine-distance operator (`pgvector` npm package handles
JS-array↔`vector` literal serialization for the query parameter), `WHERE
org_id = $1` always applied (tenancy — a similarity search never crosses
org boundaries, consistent with every other repo function taking
`OrgContext` first), optionally `AND category = $2`, `ORDER BY embedding <=>
$queryVector LIMIT $limit`.

**Ingestion hook** — `resolveTicket()` (`src/services/ticketThread.ts`,
changed): after the existing status transition, best-effort (wrapped in
try/catch, logged not thrown — never fails the resolve action):
look up the ticket's most recent **sent** draft; if none exists (a
purely-human-owned resolution with zero AI drafts), skip silently. If one
exists, call `embeddingAdapter.embed(draftBody)` and
`insertResolutionEmbedding()` with `{org_id: ctx.org_id, ticket_id,
draft_id, category: ticket.triage.category, resolution_type:
draft.resolution_type, source_text: draftBody, embedding}`.
A dedicated test asserts this path is **never** reachable from
`runEvalSet()`/`evalScorer.ts` — those call `runTriage()`/`generateDraft()`
directly and never call `resolveTicket()` at all, so eval-run tickets can
never contaminate the embeddings table structurally; the test exists to
make that guarantee explicit and regression-proof rather than to test
something the type signatures don't already prevent.

**Retrieval integration** — new `searchSimilarResolutions(ctx,
queryText, category?, limit=3): Promise<string[]>` in `retrieval.ts`
(embeds `queryText` via the shared adapter, calls
`findSimilarResolutions()`, returns each result's `source_text`).
**`buildDraftUserPrompt()`** (`src/services/prompts/draft.v1.ts`, changed):
appends a new, clearly-labeled section — "Similar past resolutions
(context only, not a citable source)" — listing the returned snippets. No
`GuardrailResult` schema change: `outputScan.ts`'s existing
`checkCitationSubset` already only accepts doc IDs present in
`kb_documents`, so a model citing a `ticket_id` as if it were a KB doc is
already rejected by existing code, unchanged.

**Invariant #6 note:** embedding ingestion writes no `agent_runs` row and
produces no guardrail decision — a narrow, explicitly named carve-out (HLD
v4 ADR-21), not a silent exemption.

---

## 6. W16 — Layered Guardrails

**`GuardrailResult.layer`** (`src/domain/schemas.ts`, changed): enum
extended from `["input_scan", "prompt_structure", "output_scan"]` to add
`"semantic_judge"`, `"org_policy"`, `"tool_execution"` — additive, existing
values/consumers unchanged.

**Eager L1** — `simulateInbound()` (`ticketThread.ts`, changed): calls
`inputScan(ticket.subject, body)` synchronously right after inserting the
inbound message (previously only ever called from within the
triage/draft pipeline). Results are attached to the inserted message's
in-memory return value for the caller to log/expose if desired, but do
**not** block the insert or change `simulateInbound()`'s transition logic
— `should_escalate` override application stays exactly where it already
lives, inside `runTriage()`, which still separately calls `inputScan()`
itself (now scanning the same content twice — once eagerly at insert-time
for early visibility, once at pipeline-time for the actual disposal
decision — an intentional, small redundancy over adding cross-call state).

**Semantic judge** — new `src/services/guardrails/semanticJudge.ts`:
`semanticJudgeScan(modelAdapter, draft: RawDraftOutput,
ctx): Promise<GuardrailResult>`. One `modelAdapter.complete()` call, same
one-retry-then-fail-closed-on-repeated-failure shape `triage.ts`/`draft.ts`
already use, prompting a distinct, cheaper judge-tier model (env
`JUDGE_MODEL_NAME`, otherwise falls back to `MODEL_NAME`) with a small,
deliberately generic rubric: does the draft stay in scope, avoid making
unauthorized commitments (pricing, refund amounts, timelines not backed by
a tool action), and maintain an appropriate tone — never a rubric item
naming a specific KB doc ID or ticket ID (invariant #2 review gate).
Returns one `GuardrailResult` (`layer: "semantic_judge"`), appended to
`draft.ts`'s existing `guardrail_results` array after `outputScan()` runs.
On judge failure (model error after retry, or a failing verdict), the
**same** fail-closed substitution `draft.ts` already performs for an
`outputScan()` failure is reused — not a second disposal path.

**Org policy-pack rule layer** — new `src/policy_packs/{vertical}/
guardrail_rules.json` (one file per existing vertical, alongside the
current per-vertical `tool_catalog`/eligibility policy stamping), shape:

```json
{ "rules": [ { "check": "no_legal_advice", "pattern": "...", "layer": "org_policy" } ] }
```

New `orgPolicyScan(draft: RawDraftOutput, ctx): GuardrailResult[]` in
`src/services/guardrails/orgPolicyScan.ts`, reusing `outputScan.ts`'s
existing internal pattern-match helpers (`tokenize`/regex-check shape)
rather than duplicating them — loads the org's vertical's rule file once,
evaluates each rule against the draft body, same `GuardrailResult` shape
(`layer: "org_policy"`). Called alongside `outputScan()` in `draft.ts`,
results appended to the same array; a failure from either feeds the same
existing fail-closed substitution.

**Tool-execution-time guardrail** — new
`src/services/guardrails/toolExecutionScan.ts`:
`toolExecutionScan(ctx, action: ToolActionRow): Promise<GuardrailResult>`
re-runs the same catalog-driven constraint checks `outputScan.ts`'s
`checkActionValidity` already performs at draft time (tool exists in
catalog, payload has catalog-required fields), plus one execute-time-only
fact: the ticket is still in a non-terminal status (not already
`resolved`/`closed`) — re-validated because time has passed since the
draft was approved. Called from `executeToolAction()`
(`src/services/toolActions.ts`, changed) immediately before the existing
`ELIGIBILITY_GATED_TOOLS` check, fail-closed: on failure, returns a new
**`ExecuteOutcome`** kind, `{ kind: "guardrail_blocked"; action:
ToolActionRow; result: GuardrailResult }` — the action row's `status` stays
`"approved"` (unchanged; a blocked attempt is not a terminal failure the
way `"failed"` is, since the blocking condition — e.g. ticket reopened —
may not recur on a later retry).

---

## 7. W17 — Customer-Facing Chat Portal

**`CustomerToken`** (new, `src/domain/authTypes.ts`):

```ts
export interface CustomerTokenClaims {
  customer_id: string;
  org_id: string;
  ticket_id?: string;
  kind: "customer";
}
```

Signed/verified via new `signCustomerToken()`/`verifyCustomerToken()` in
`tokens.ts`, sibling to the existing `signToken()`/`verifyToken()` — same
`JWT_SECRET`, same `HS256`, a **shorter** expiry (`1h`, re-verify to renew)
since this token is minted from an unauthenticated ownership check, not a
password login. `requirePermission()` (`src/api/middleware/permissions.ts`)
is unchanged and rejects a `CustomerTokenClaims` payload by construction —
it has no `role` field, so `roleHasPermission(undefined, ...)` is `false`
for every permission.

**`POST /customer-auth/verify`** (public, unauthenticated, new
`src/api/routes/customerAuth.ts`, mounted in `app.ts` at the same public
tier as `/signup` — before `authMiddleware`): request
`{ org_slug: string, email: string, order_id: string } | { org_slug:
string, email: string, ticket_id: string }`. **As built:** not a zod
`discriminatedUnion()` — the two shapes share no literal discriminant
field, which that combinator requires. `CustomerVerifyRequest`
(`src/domain/authTypes.ts`) is instead a single object with `order_id`/
`ticket_id` both optional, plus a `.refine()` enforcing exactly one is
present; it accepts and rejects the identical set of bodies. Rate-limited
stricter than `/signup`'s 10/hour/IP — 5/hour/IP, since this route accepts
an email+identifier guess shape open to enumeration. Resolves `org_slug` →
org, looks up the customer by email within that org (`getCustomerByEmail()`,
new — trivial addition to `customersRepo.ts`), confirms the supplied
`order_id`/`ticket_id` actually belongs to that customer (reusing the same
ownership-check logic `POST /tickets` already applies when validating a
submitted `order_id` against a `customer_id`). On any failure (unknown org
slug, unknown email, or a known email with a mismatched order/ticket),
responds with the **same** generic `401 UNAUTHENTICATED "Verification
failed"` — no field indicates which part failed, closing the enumeration
channel (**as built:** the error *code* is `UNAUTHENTICATED`, the existing
code this app's error envelope already uses for every other 401 — there is
no separate `UNAUTHORIZED` code in `errorEnvelope.ts`). On success, returns
`{ data: { customer_token, customer: {customer_id, name}, ticket_id? } }`
(`ticket_id` present only if verification was ticket-scoped, letting the
frontend distinguish "continue an existing ticket" from "start a new one").

**`src/api/middleware/customerAuthMiddleware.ts`** (new): reads
`CustomerToken` from `Authorization: Bearer`, verifies it, populates
`req.customerContext = {customer_id, org_id, ticket_id}`. Applied only to
any future REST route on this surface — never mixed into the existing
`authMiddleware`/`requirePermission()` chain. **As built:** the WS
handshake does *not* run through this Express middleware — a WS upgrade
never enters the Express middleware chain at all — so
`src/ws/customerChatServer.ts` calls `verifyCustomerToken()` directly
inline instead (same verification, same rejection outcome, just not routed
through this specific middleware function). `customerAuthMiddleware` is
currently exercised only against a throwaway router in its own test
(`tests/e2e/customerAuth.test.ts`, same pattern `tests/e2e/auth.test.ts`
already used for `authMiddleware` before v2 added protected routes to
`app.ts`), since no REST route under `/customer-auth`/`/portal` besides
`POST /verify` (public, unguarded by design) exists yet to mount it on.

**Pipeline extraction** — new `src/services/ticketIntake.ts`: the
greeting→triage→draft→auto-send orchestration currently inlined in
`tickets.ts`'s `POST /` handler is extracted verbatim into
`createTicketWithPipeline(ctx, modelAdapter, request):
Promise<{ticket, pipeline}>`, called identically by the (unchanged-behavior)
`POST /tickets` route and the new WS handler. Pure refactor milestone: full
existing suite must pass unchanged before any WS code is written against
it. **As built (extended in V4-23):** the actual signature is
`createTicketWithPipeline(ctx, modelAdapter, embeddingAdapter, request,
onTicketCreated?): Promise<CreateTicketOutcome>` — `embeddingAdapter` was
missing from this draft signature (`generateDraft()` requires one);
`CreateTicketOutcome` is a tagged union (`invalid_customer` /
`invalid_order` / `order_customer_mismatch` / `{kind: "ok", ticket,
pipeline}`), not a bare `{ticket, pipeline}`, so `tickets.ts`'s route
translates the typed outcome into the same HTTP responses it always
returned rather than validating inline; and `onTicketCreated`, an optional
callback fired synchronously right after the ticket + its seed messages
commit (before the pipeline starts), was added so the WS handler can
subscribe to this ticket's live-message channel *before* an auto-send could
possibly publish to it — see `runIntakePipeline()` below. The
triage→draft→auto-send portion specifically (not the ticket/message
creation) is further factored into `runIntakePipeline(ctx, modelAdapter,
embeddingAdapter, ticket, customer, order): Promise<PipelineSummary>`,
which `createTicketWithPipeline()` calls internally — this is what
`customerChatServer.ts` also calls after a *subsequent* portal message
(`receiveCustomerMessage()`), so a returning customer's follow-up message
gets the identical re-triage/draft/auto-send treatment a brand-new ticket
gets, without duplicating that sequence. `runIntakePipeline()` also enforces
invariant #11 (human-owned tickets never get AI drafting) directly, since
unlike the draft-reply *route* it has no HTTP layer above it to 409 first.

**`receiveCustomerMessage(ctx, ticket, body)`** (new,
`src/services/ticketThread.ts`, structurally identical to
`simulateInbound()` — same status-transition check, same eager-L1 call
from W16 — the only difference is the message's `author` is the verified
`customer_id` rather than the literal string `"customer"`, preserving a
distinction between an agent-simulated inbound message and one genuinely
authored by a verified portal session).

**`src/ws/customerChatServer.ts`** (new): a `ws.Server` attached at `path:
"/customer-chat"` on the existing `http.Server` (wired in `server.ts`, not
`app.ts` — WS attachment needs the raw HTTP server, which only `server.ts`
constructs; `app.ts`/the exported `app` used by every test stays HTTP-only,
consistent with the existing test-never-touches-real-infra boundary).
Handshake: read `token` from the connection URL's query string, verify via
`verifyCustomerToken()`; reject the upgrade (close code 4001) on an invalid
or expired token. On connect: if `ticket_id` is present in the token,
replay `ticket_messages` for that ticket (stateless reconnect — no server
session to restore); if absent, wait for the client's first chat message to
call `createTicketWithPipeline()` and establish the ticket. Subsequent
client messages call `receiveCustomerMessage()`, then `runIntakePipeline()`
(the same triage/draft/auto-send sequence a fresh ticket gets — see
"Pipeline extraction" above). Server pushes: an `{type: "message", ...}`
frame for every **`sent`**-status outbound message (auto-sent or a
subsequently human-sent reply). **As built:** rather than subscribing to
`pipelineEventBus` (which is keyed by `run_id`, the wrong shape for this —
a portal connection also needs to hear about an out-of-band human reply
sent hours later with no `run_id` in play at all), this is a new,
deliberately separate ticket-keyed pub/sub, `customerThreadBus`
(`src/services/events/customerThreadBus.ts`, a small `EventEmitter`
wrapper mirroring `pipelineEventBus`'s shape but keyed by `ticket_id`
instead of `run_id`). `sendDraft()` and `sendManualReply()`
(`ticketThread.ts`) — the only two call sites that ever produce a
sent-status outbound message — publish to it on every successful `"ok"`
outcome; `customerChatServer.ts` subscribes to the connected ticket's
channel on connect/reconnect (and re-subscribes the moment a brand-new
ticket's ID becomes known, via `createTicketWithPipeline()`'s
`onTicketCreated` callback, closing the subscribe-after-publish race an
immediate auto-send would otherwise risk). The status frame,
`{type: "status", text: "a support specialist will respond shortly"}`, is
sent when `runIntakePipeline()`'s returned summary shows `draft: true,
auto_sent: false` — a direct, synchronous check of that call's own return
value, not a bus subscription. Either way, **never** the pending draft
body or its guardrail outcome — this module only ever reads
`PipelineSummary`'s booleans, never a `DraftOutcome`.

**Frontend `/portal/*`** (new routes inside the existing `App.tsx`
`BrowserRouter`, which already splits public/authenticated trees):
`frontend/src/portal/PortalVerify.tsx` (the `POST /customer-auth/verify`
form), `frontend/src/portal/PortalChat.tsx` (chat UI, reuses
`ChatThread.tsx`'s bubble-rendering concept as a simpler, portal-scoped
component — no agent-facing controls), `frontend/src/portal/
usePortalSocket.ts` (WS connection hook: connect with the stored
`customer_token` query param, dispatch incoming frames, expose a `send()`).
Minimally styled in v4 (functional; visual pass is v5 per HLD v4 ADR-24).

**New deps:** `ws`, `@types/ws` (backend `package.json`).

---

## 8. V4 Milestones (TDD, each green before the next)

| # | Milestone | Tests written first |
|---|---|---|
| V4-1 | `HLD_v4.md`/`LLD_v4.md`/`ticket_lifecycle_v4.mermaid` + draft CLAUDE.md invariant #6/#8 amendment language | n/a — docs milestone |
| V4-2 | Seed data: `data/orders.json` expanded to ~20-25 orders; `ord_5001`-`ord_5006` byte-identical | full v1-v3 suite green incl. eval_005/006/007 and eligibility tests asserting exact seed fields |
| V4-3 | `listOrdersByCustomerId()` + `GET /customers/:id/orders` | repo test (multi-order customer, org isolation); route integration test (404 unknown customer, 200 with array) |
| V4-4 | Frontend: `CustomerCard`/`OrderCard`/order-history section, `TicketView.tsx` JSON→card swap | manual browser QA |
| V4-5 | `PipelineStage` gains `"eval_case"` + `run_events` CHECK migration | migration up/down; `emitStage(..., "eval_case", ...)` round-trips through `runEventsRepo` |
| V4-6 | `runEvalSet()` restructure (ID minted upfront, per-case event emission) + `POST /eval-runs/start` + `eval_run_id` passthrough | unit test on emission order/content; integration test on `/start` minting an unpersisted-but-usable ID |
| V4-7 | `GET /eval-runs/:runId/events` SSE route | integration test: replay path (run already complete) and live-subscribe path (events arrive mid-stream), terminal close in both |
| V4-8 | Frontend: `EvalRunStepper.tsx` + rotating copy in `EvalReport.tsx` | manual browser QA |
| V4-9 | `docker-compose.yml` image swap + pgvector migration | extension-presence test (`pg_extension` query); migration up/down |
| V4-10 | `EmbeddingAdapter`/`MockEmbeddingAdapter`/`createEmbeddingAdapter` (mock/local/hosted tiers) | unit tests: deterministic mock vectors, tier resolution from env, distinct-credential assertion for hosted |
| V4-11 | `resolutionEmbeddingsRepo.ts` (insert + nearest-neighbor query) | insert/query round-trip against deterministic mock vectors; org-isolation test (cross-org query returns nothing) |
| V4-12 | Ingestion hook in `resolveTicket()` | sent-draft case inserts a row; no-AI-draft case skips silently; embedding failure doesn't fail the resolve; explicit "eval runner never reaches this path" test |
| V4-13 | `searchSimilarResolutions()` wired into `buildDraftUserPrompt()` | test asserting similar-resolution context reaches the prompt passed to `MockModelAdapter`; citation-subset guardrail still rejects a ticket-ID-as-doc-ID citation |
| V4-14 | Eager L1 on `simulateInbound()` | inbound message with an adversarial phrase produces an early `GuardrailResult` at insert time, independent of pipeline trigger |
| V4-15 | Semantic judge layer | flagged- and clean-draft scenarios via `MockModelAdapter`'s judge-tier response; failure feeds the existing fail-closed substitution |
| V4-16 | Org policy-pack rule layer | per-vertical rule file loaded correctly; cross-vertical isolation (org A's rules never apply to org B) |
| V4-17 | Tool-execution-time guardrail | `guardrail_blocked` outcome on a catalog-invalid re-check; approved-but-blocked action remains retryable |
| V4-18 | Full guardrail regression | eval_005/006/007 plus new W16 layer tests all green; new layers confirmed not more permissive than pre-v4 baseline on existing adversarial fixtures |
| V4-19 | `CustomerToken` sign/verify + `customerAuthMiddleware` | agent JWT rejected on `/portal/*`; customer token rejected on every `requirePermission()`-guarded route (both directions) |
| V4-20 | `POST /customer-auth/verify` | happy path (order-scoped and ticket-scoped); unknown org slug, unknown email, and mismatched order/ticket all return the identical generic 401; rate limit trips past threshold |
| V4-21 | Extract `ticketIntake.ts` | full existing `POST /tickets` test suite green, unchanged, against the refactored code path |
| V4-22 | `receiveCustomerMessage()` + `customerChatServer.ts` skeleton | connect with valid/invalid/expired token; ticket-scoped reconnect replays `ticket_messages` correctly |
| V4-23 | WS pipeline-progress + auto-send-vs-pending bridging | auto-sent message reaches the WS client verbatim; pending/escalated draft never reaches the WS client, only the generic status frame |
| V4-24 | Frontend: `/portal/*` (`PortalVerify`, `PortalChat`, `usePortalSocket`) | manual browser QA |
| V4-25 | New adversarial test: portal-submitted injection caught by eager L1; CLAUDE.md invariant #8 amendment finalized against what W17 actually built | integration test, permanent alongside eval_005/006/007 |
| V4-26 | Frontend: favicon, `Shell.tsx` typography/nav, dashboard chart/KPI restyle, Tailwind keyframes | manual browser QA; `npm run typecheck`/`build` clean |
| V4-27 | Doc reconciliation: `HLD_v4.md`/`LLD_v4.md`/`ticket_lifecycle_v4.mermaid`/`CLAUDE.md` checked against what was actually built | n/a — docs milestone |
| V4-28 | Final regression | full v1-v4 suite green incl. eval_005/006/007 and V4-25's portal-injection test; `npm run smoke:local` re-verified; manual demo walkthrough of both the agent app and `/portal/*` |

**Standing regression rule (unchanged since v1, extended each version):**
the full v1+v2+v3 suite, including eval_005/006/007 adversarial tests,
runs green at the end of every v4 milestone; from V4-25 onward, the new
portal-injection adversarial test joins that permanent set.
