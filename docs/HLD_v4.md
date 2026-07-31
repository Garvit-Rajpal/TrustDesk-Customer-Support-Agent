# TrustDesk — HLD v4 (Product Extension)

**Version:** 4.0 · **Extends:** `HLD_v3.md` (v1/v2/v3 remain valid; this document only adds and amends) · **Status:** Agreed baseline for LLD v4

V3 made TrustDesk something a stranger could sign up for and run
autonomously: self-serve onboarding, auto-resolution, human takeover,
consent-gated platform oversight. V4 makes it more *trustworthy* and more
*complete*: richer demo data so ad-hoc tickets look like a real account,
a properly rendered ticket detail view instead of raw JSON, live streaming
progress for eval runs (not just single-ticket pipelines), similarity-based
grounding from past resolutions, guardrails layered beyond a single
input/output pass, and — the biggest new surface — a customer-facing chat
portal so an end customer can open and continue a ticket without an agent
typing on their behalf. A cross-org "pattern sharing" capability is
proposed here as a fully specified design, deliberately **not implemented**
in v4 (see Future Work) to keep tenant-isolation risk at zero this round.

**Docs-first, same convention as every prior version.** Per this project's
own rule ("read [HLD/LLD] before any work"), this document and `LLD_v4.md`
are written *before* any v4 code changes, as the spec that W12-W18
implement against — not a changelog assembled afterward. They remain living
documents: later workstreams amend them in place as implementation surfaces
details the upfront design didn't anticipate (flagged explicitly, never
silently), the same pattern ADR-15 already used for a carried-forward
limitation.

**V4 workstreams and build order:**

| # | Workstream | Depends on |
|---|---|---|
| W11 | This document + `LLD_v4.md` + `ticket_lifecycle_v4.mermaid` + CLAUDE.md draft amendments | W10 (v3 complete) |
| W12 | Dummy data enrichment (richer per-customer order histories) | W11 |
| W13 | Ticket detail: JSON→table, order history | W12 |
| W14 | Eval-run streaming progress (SSE, reusing the v2 pipeline-event pattern) | W11 |
| W15 | pgvector similarity ingestion (past resolutions ground future drafts) | W11, W12 (soft) |
| W16 | Layered guardrails (eager L1, semantic judge, org-policy rules, tool-execution-time check) | W11 |
| W17 | Customer-facing chat portal (lightweight verification, WebSocket transport) | W14, W16, W12/W13 |
| W18 | Frontend modernization — cheap wins only in v4 (deep visual polish deferred to v5) | W13, W14 |
| W19 | Doc reconciliation + final regression — split as `LLD_v4.md`'s milestone table's V4-27 (docs) and V4-28 (regression) | everything |

**Compatibility guarantee:** every v1/v2/v3 test stays green throughout. All
new DB columns/tables are additive (no backfill migrations beyond the
one-time pgvector image swap in W15, which is a dev-environment
infrastructure change, not a data migration). No existing route's
request/response shape changes except where explicitly amended below, and
those changes are additive (new optional fields, new routes), not breaking.

**Scope note:** per the project owner's decision, v4 ships all seven
requested improvement tracks as working, tested code. Deep visual/UX polish
— the animated landing-page chat demo, testimonials carousel, footer, full
login/signup/dashboard redesign, and a visual pass on `/portal/*` — is
deliberately deferred to v5 so the milestone-gated TDD discipline this
codebase depends on doesn't slip under roughly 3x v3's scope. W18 in v4
covers only the cheap, low-risk wins (favicon, typography, chart restyle,
CSS keyframe groundwork).

---

## New ADRs

### ADR-19: Dummy data enrichment + ticket detail rendering (W12, W13)

Today's seed data has a 1:1 customer↔order pairing that was never a schema
constraint — `orders.customer_id` is a plain FK, so a customer can already
own many orders; nobody had populated more than one. V4 expands
`data/customers.json`/`data/orders.json` to 20-25 orders spread across the
6 seed customers (varied status/items/dates), so a ticket created ad hoc in
the demo has a believable order history behind it, and adds
`GET /customers/:id/orders` to serve that history. The existing
`ord_5001`-`ord_5006` rows are **never mutated** — `data/eval_cases.jsonl`
and the eligibility test suite assert exact field values on them, and
invariant #4 (expected-label isolation) sets the precedent that seed
fixtures backing the eval suite are read-only ground truth, never touched
for a cosmetic reason.

Separately, `TicketView.tsx` has rendered `customer`/`order` as a raw
`<pre>{JSON.stringify(...)}</pre>` since v1 — a placeholder that was never
revisited once the API contract stabilized. V4 replaces it with real
`CustomerCard`/`OrderCard` components and an order-history table (backed by
the new endpoint above). This is a display-layer-only change: `ActionPanel`
and every other consumer of `ticket`/`customer`/`order` keeps the exact
same shape from the API; nothing in the backend contract changes.

### ADR-20: Eval-run streaming progress (W14)

HLD v2 ADR-8 gave single-ticket pipeline runs a live SSE view
(`RunStepper`) built on the in-process `PipelineEventBus`. `EvalReport`
never got the equivalent — the eval runner (`runEvalSet()`) has always run
its ~9 seed cases synchronously in a loop with no visibility until the
whole batch finishes, per the "8 seed cases never approach the async
threshold LLD allows for" reasoning in `evalRunner.ts`. That reasoning
still holds for *execution strategy* (no queue/worker infrastructure is
justified for a dataset this size) but not for *observability* — a
9-case run can take long enough that a static "Running…" screen with no
feedback reads as broken, especially with the layered guardrails added in
W16 making each case more expensive.

V4 reuses the exact `PipelineEventBus`/SSE mechanism ADR-8 already built,
adding a new `"eval_case"` `PipelineStage` value and a new
`GET /eval-runs/:runId/events` route mirroring the existing
`GET /tickets/:id/runs/:runId/events` almost verbatim: replay persisted
events, then subscribe live until a terminal event. The one structural
change needed is minting the `eval_run_id` **before** the run starts
(currently `insertEvalRun()` only happens after `runEvalSet()` completes,
so there is no ID a client could subscribe against mid-run) — a new
`POST /eval-runs/start` mints and returns `{eval_run_id}` synchronously, and
`POST /eval-runs` is extended to optionally accept that ID and reuse it
instead of minting its own. No change to the underlying pipeline
mechanics: `runOneCase()` still calls the exact same `runTriage()`/
`generateDraft()` functions, unchanged, that both the live API and every
prior eval run already used — this is purely an observability layer over
work that already happens, same principle ADR-18 used for
"perceived streaming, not real streaming."

### ADR-21: pgvector similarity ingestion (W15)

HLD v1's `RetrievalService` was deliberately built "interface-first" with a
code comment anticipating exactly this: "so the FTS engine can be swapped
for Elasticsearch/pgvector later without touching callers." V4 exercises
that seam — not as a replacement for the existing Postgres full-text-search
knowledge-base retrieval (unchanged), but as a second, additive retrieval
path: once a ticket resolves with a **sent** draft, its resolution gets
embedded and stored; a future ticket's draft-generation prompt gets
appended with the 1-3 most similar past resolutions as extra grounding
context.

This requires Postgres's `vector` extension, so `docker-compose.yml`'s
`postgres:16` image is swapped for `pgvector/pgvector:pg16`. **Correction
during W15 implementation:** the original plan assumed this needed the
local Docker volume recreated. It doesn't — `pgvector/pgvector:pg16` is
Postgres 16 plus the `vector` extension's shared library, not a different
database; the on-disk format is unchanged, so an existing volume starts up
against the new image without modification, and the migration's `CREATE
EXTENSION IF NOT EXISTS vector` is all that's actually needed. Recreating
the volume remains a reasonable fallback if a container ever fails to
start against pre-existing data, but is not the expected path.

**Embedding provider** mirrors the existing `MODEL_TIER=mock|local|hosted`
pattern (`createModelAdapter.ts`) exactly, via a parallel
`createEmbeddingAdapter.ts`: `mock` (deterministic fake vectors, used in
every test, same rule LLD v1 §1 already applies to `MockModelAdapter`),
`local` (an Ollama embedding-capable model such as `nomic-embed-text` via
Ollama's OpenAI-compatible endpoint — the same local dev story
`OPENAI_BASE_URL_LOCAL` already supports for chat completions), `hosted`
(a small purchased embeddings API, via a new, **distinct**
`EMBEDDINGS_API_KEY` env var). This distinctness is not cosmetic: this
project's `OPENAI_API_KEY`/`OPENAI_BASE_URL` point at OpenRouter, not real
OpenAI (per the existing `.env` comment) — OpenRouter does not serve
embeddings, so a hosted embedding call is a structurally different
credential and endpoint, never a reuse of the chat-completion key.

**Ingestion is best-effort and narrowly scoped.** It hooks into
`resolveTicket()`, wrapped in try/catch so an embedding failure never fails
the resolve action itself. It reads only real `tickets`/`drafts` rows for
tickets that had at least one **sent** draft (a purely human-owned
resolution with no AI draft is skipped, silently — there's nothing to
embed). It **never** reads `data/eval_cases.jsonl` or
`ticket_expected_labels` — those are the eval scorer's read-only ground
truth (invariant #4), and eval-run tickets in `org_default` are excluded
from ingestion by construction (ingestion only fires from the real
`resolveTicket()` code path an agent/auto-resolution flow calls; the eval
runner never calls it). A dedicated regression test asserts this
explicitly, even though org/table scoping already prevents it structurally
— the same "flag it explicitly, don't rely on nobody noticing" posture
ADR-15 modeled for the L1-scanning gap.

**Retrieval integration** is additive to the existing prompt, not a
replacement: similar-resolution snippets are appended to
`buildDraftUserPrompt()` as informational, non-citable context. No
guardrail schema change is needed for this — `outputScan.ts`'s existing
`citation_subset` check already validates a model's cited doc IDs only
against real `kb_documents`, so a model "citing" a past ticket ID as if it
were a KB doc is already rejected today, with zero new code.

**Invariant interaction:** embedding ingestion is a narrow, explicitly
named carve-out to invariant #6 ("every AI run writes `agent_runs`
synchronously with non-empty `guardrail_results`") — it is not customer-
facing output, produces no guardrail decision, and writes no
`agent_runs` row; it is closer to the seed loader's `upsertOrder()`-style
housekeeping than to a triage/draft run. This carve-out is named explicitly
here rather than silently treated as exempt.

### ADR-22: Layered guardrails (W16)

V1-v3 guardrails are two real layers plus one structural no-op: L1
(`input_scan`, pre-LLM regex, never blocks — only forces
`should_escalate`), L2 (`prompt_structure`, "passes by construction," a
structural placeholder rather than a real check), L3 (`output_scan`,
post-LLM regex, fail-closed template substitution on failure). ADR-15
already flagged one known gap explicitly: L1 has always been
pipeline-triggered (runs when triage/draft next process a message), not
insert-triggered — `simulateInbound()` itself never scans. V4 closes that
gap and adds three genuinely new layers, all deliberately built as
*additions* to the existing fail-closed substitution point in
`draft.ts`/`GuardrailResult` array (invariant #5/#6), never a second,
parallel disposal mechanism:

1. **Eager L1** — `inputScan()` now also runs synchronously inside
   `simulateInbound()` (and W17's new customer-portal message path) at
   message-insert time, in addition to its existing pipeline-triggered
   call. Disposal logic (`should_escalate` override) is unchanged; this
   only changes *when* the scan first runs, closing the window ADR-15
   flagged.
2. **Semantic judge layer** — a second `modelAdapter.complete()` call
   (same one-retry-then-fail-closed shape `triage.ts`/`draft.ts` already
   use), scoring an already-L3-passed draft against a small, deliberately
   **generic** rubric (tone, scope-creep, unauthorized-commitment
   detection) — reviewed explicitly against invariant #2 ("guardrails are
   generic, never blacklist by ID") since a rubric is exactly the kind of
   thing that's tempting to accidentally overfit to `eval_005`'s specific
   phrasing. Uses a distinct, cheaper judge-tier model (an extension of the
   existing `MODEL_TIER` adapter concept, not a new adapter interface).
   Explicitly a latency/quality tradeoff, not a free win — documented as
   such in LLD v4.
3. **Per-org policy-pack rule layer** — declarative,
   `src/policy_packs/{vertical}/guardrail_rules.json`, evaluated by a new
   `orgPolicyScan()` alongside the existing `outputScan()` in `draft.ts`,
   reusing `outputScan.ts`'s existing pattern-match helpers and
   `GuardrailResult` shape rather than inventing a parallel one. Lets a
   vertical's policy pack (already the mechanism stamping tool-catalog
   constraints per org since v1) add its own output-time rules without a
   code change per org.
4. **Tool-execution-time guardrail** — `executeToolAction()` re-validates
   eligibility for the two eligibility-gated tools today
   (`ELIGIBILITY_GATED_TOOLS`), but nothing re-checks the *catalog*
   constraints `outputScan.ts`'s `checkActionValidity` already checks at
   draft time — a window exists between a draft being approved and
   executed where ticket state could change. A new
   `toolExecutionScan()` re-runs those catalog checks immediately before
   `mockExecute()`, fail-closed, surfaced as a new `ExecuteOutcome` kind
   (`"guardrail_blocked"`) alongside the existing `not_found` /
   `illegal_transition` / `replayed` / `executed` / `failed` outcomes.

This lands **before** W17 deliberately: the customer chat portal is a new,
less-controlled input surface (an end customer, not an authenticated
agent, is the author of the first message), so it should inherit the eager
L1 scan and the rest of the layered stack from day one rather than launch
against the pre-W16 guardrail surface.

### ADR-23: Customer-facing chat portal (W17)

The biggest new surface in v4: an end customer can open `/portal`, verify
lightweight ownership of an order/ticket, and chat to create or continue a
ticket — which appears in the org's normal ticket queue, triaged/drafted
exactly as if an agent had typed it on the customer's behalf via
`POST /tickets`.

**Identity is deliberately not a customer *account* system.** Per the
locked-in decision from planning, verification is lightweight:
`{org_slug, email, order_id | ticket_id}` — no password, no signup, no
persistent customer login. A new `POST /customer-auth/verify` (public,
unauthenticated, rate-limited *stricter* than `/signup` since
email+order-number is an enumeration-attack shape) confirms ownership via
the same lookup+match logic `POST /tickets` already performs today, then
issues a new `CustomerToken` — `{customer_id, org_id, ticket_id?,
kind: "customer"}` — a token universe with **no `Role`**, so
`requirePermission()` rejects it on every existing agent/admin route by
construction, not by an added check. Any REST route on this new surface is
guarded by a separate `customerAuthMiddleware`, never `requirePermission()`
— the WS handshake (below) verifies the same token inline instead, since a
WS upgrade never enters the Express middleware chain a REST middleware
runs in. No enumeration-revealing error difference exists between "unknown
email" and "email known, order mismatch" — both return the same generic
failure.

This is the reason invariant #8 needs its **second** explicit amendment
(v3 already amended it once, for org-admin self-signup): the current text
says end-customer auth "does not exist and is not planned." V4 makes that
sentence stale. The amendment (drafted now in W11, finalized once W17
actually ships) must describe the new verification precisely: passwordless,
non-role-bearing, scoped to a single `customer_id`'s session, and rejected
by every `requirePermission()`-guarded route by construction — a narrowly
scoped capability addition, not a reversal of the invariant's intent (there
is still no customer *account* system, no customer password, no customer
access to any other customer's or any agent's data).

**Transport is a real WebSocket** (`ws` package — chosen over `socket.io`
to match this codebase's existing pattern of thin hand-rolled wrappers over
platform primitives, e.g. the `EventEmitter`-based `PipelineEventBus`;
`socket.io`'s client library, room abstraction, and polling fallback are
all unneeded machinery here), not SSE — the existing SSE mechanism is
one-way (server→client pipeline progress); a chat portal needs true
bidirectional customer↔agent messaging. `src/ws/customerChatServer.ts`
attaches at `path: "/customer-chat"` on the existing `http.Server`. The
handshake reads the `CustomerToken` from the connection URL's query string
(a WebSocket handshake can't set arbitrary custom headers, the same
constraint the SSE routes already work around by putting the JWT in a
query param today). Reconnection is stateless by design: `ticket_messages`
is the durable source of truth, so a reconnecting client simply replays
history via the same token/URL — no server-side session state to restore.

**No duplicated pipeline logic.** The greeting→triage→draft→auto-send
orchestration currently inlined in `tickets.ts`'s `POST /` handler is
extracted, unchanged, into a new `src/services/ticketIntake.ts`, called
identically by the existing HTTP route and the new WS handler. This is a
pure refactor milestone (full existing suite must stay green, byte-for-byte
unchanged behavior) landing *before* the WS handler is wired to it, so the
extraction's correctness is verified in isolation.

**Auto-send-vs-pending rule, portal-specific:** only `sent`-status messages
are ever pushed to a customer's WS connection. When `evaluateAutoSend()` is
true, the reply streams to the customer immediately, same content a human
would see. When false (escalated, refused-by-policy, or an approval-gated
action), the customer WS receives a generic
`{type: "status", text: "a support specialist will respond shortly"}` —
**the draft itself, and its guardrail outcome, are never sent to the
customer client**, regardless of what L3/the semantic judge/org-policy
layer decided, since a pending draft is by definition not yet
human-reviewed. This is a customer-facing consequence of invariant #5's
existing "keep rejected draft on trace, never redact in place" rule: the
draft/trace stays fully visible to agents/managers as always; the portal
is simply never a reader of that internal state.

**Known limitation, stated not hidden:** the WS server's live-delivery
mechanism — `customerThreadBus`, an in-process `EventEmitter` keyed by
`ticket_id` (see `LLD_v4.md` §7's "as built" note; not literally
`PipelineEventBus`, which is `run_id`-keyed and serves the SSE stepper) —
does not horizontally scale past a single Node process without shared
pub/sub (Redis or equivalent), the same structural limitation
`PipelineEventBus` itself already has. Acceptable for this capstone's
single-process deployment, and explicitly named here as the same class of
carried-forward, documented limitation ADR-15 already modeled for the
L1-timing gap.

### ADR-24: Frontend modernization — v4 cheap wins (W18)

V4's frontend scope is deliberately narrow: replace the default Vite
favicon, a typography/nav pass on `Shell.tsx`, and a visual restyle of the
dashboard's chart/KPI blocks (`Dashboard.tsx`, `MetricTile.tsx`, the
`recharts` wrapper — the `dataviz` skill is invoked during the actual W18
implementation, not before). New Tailwind keyframes are added to
`tailwind.config.js` as groundwork a v5 pass can build animations on top
of, following the same theme-extension pattern already used for status
colors.

**Recommendation, carried from planning: stay CSS-only, do not add
framer-motion.** This codebase's existing precedent — ADR-18's
`useTypewriter` hook, chosen specifically for "the same 'it's alive' feel
with zero exposure risk" via plain CSS/JS rather than a library — is
exactly the pattern the v5 testimonials carousel/chat-demo/page transitions
should extend. `framer-motion` (~50-60kb gzipped) would be the first
animation dependency pulled into a frontend that currently has zero; that
tradeoff is worth revisiting at v5 kickoff if Tailwind keyframes prove
insufficient, but the default for both v4 and v5 is no new dependency
unless proven necessary.

Deferred to v5: the animated landing-page chat demo, testimonials carousel
+ footer, full login/signup visual refinement, and a `/portal/*` visual
design pass (v4 ships `/portal/*` functional but minimally styled).

---

## Amended sections

- **§3 Components (HLD v1, extended v2/v3):** add `OrdersService`
  (order-history lookups, W12), `EvalStreamingService` (eval-run
  event-emission wiring, W14 — thin, reuses `PipelineEventBus` unchanged),
  `EmbeddingAdapter`/`EmbeddingService` (W15, mirrors `ModelAdapter`'s
  shape), `SemanticJudgeService`/`OrgPolicyScanService`/
  `ToolExecutionScanService` (W16, all plug into the existing
  `GuardrailResult`/fail-closed contract), `CustomerAuthService`,
  `TicketIntakeService` (the `tickets.ts` extraction), `CustomerChatServer`
  (W17).
- **§5 Guardrails:** four new layers described in ADR-22, all additive to
  the existing L1/L2/L3 pipeline and its single fail-closed substitution
  point — no second disposal mechanism is introduced anywhere in v4.
- **§8 Roadmap:** v4 implements six of the seven originally-requested
  tracks as working code (data enrichment, ticket-view rendering,
  eval streaming, similarity ingestion, layered guardrails, chat portal)
  plus frontend cheap-wins; the seventh (cross-org data *utilization*
  beyond read-only viewing) is specified below as a design proposal only.
  New v5+ candidates surfaced by this round: full frontend visual
  redesign; magic-link/email-verified customer sessions (today's
  `CustomerToken` is per-verification, not persistent); horizontally
  scalable pipeline-event delivery (Redis pub/sub) if the WS/SSE
  single-process limitation ever needs to be lifted; implementing the
  cross-org proposal below beyond a design doc, if ever pursued.

## Future Work: Cross-Org Pattern Sharing (design proposal, NOT IMPLEMENTED in v4)

Today's platform-support visibility (HLD v3 ADR-16) is **read-only**: an
`org_default` agent with consent and permission can *look at* a
consenting tenant's tickets/metrics, but nothing in the system *uses* one
org's resolved tickets to improve another org's outcomes. The project
owner asked for a plan to change that. This section specifies a concrete,
privacy-conscious design — deliberately **not implemented in v4** — to
keep this round's tenant-isolation risk at zero while the design gets
review.

**What it would be:** a new `platform_pattern_signals` table storing only
**aggregate, per-org-per-category centroid embeddings** — never raw
per-ticket content, never a raw per-ticket vector. A category's centroid
is the mean of that org's category's resolution embeddings (the same
embeddings W15 already computes for in-org similarity), recomputed
periodically, not per-ticket. A third consent boolean,
`allow_platform_pattern_sharing`, distinct from v3's two existing
flags — a tenant opting into "help other tenants" is a materially
different, and more consequential, decision than opting into "let the
platform operator look at my tickets," and must be its own explicit
choice.

**Anonymity floor:** a pattern only ever surfaces once at least
**5 distinct consenting orgs** have contributed to that
category's aggregate (a k-anonymity-style threshold) — below that, the
signal simply doesn't appear, rather than appearing with a small,
potentially re-identifying contributor set.

**Proposed surface:** `GET /platform/pattern-insights?category=`, open to
every consenting *contributing* org (not just `org_default`) — "you get to
see the aggregate because you contributed to it" — returning something
like a category's typical resolution-type distribution or common
recommended-action patterns, never a specific ticket, customer, or org
attribution.

**Explicit non-goals**, stated so this proposal isn't mistaken for a
bigger step than it is: no cross-org draft generation (a draft is always
generated from the requesting org's own retrieval/eligibility context
only); no shared fine-tuning or model training across orgs; no per-ticket
cross-org lookups of any kind (only the pre-aggregated, k-anonymized
signal ever crosses the org boundary). This keeps the design consistent
with every existing tenancy invariant — `OrgContext`-scoped repo access,
consent-gated crossing, read-only-in-spirit even though it's now
"aggregate-write, individual-read."

## V4 traceability (capstone rubric)

W15 (similarity ingestion) and W16 (layered guardrails) are the two tracks
most directly aimed at "more robust and accurate" — grounding drafts in
real historical outcomes and adding real defense-in-depth beyond a single
input/output pass. W17 (chat portal) is the largest net-new surface,
extending "a real product a stranger could sign up for and use" (the v3
framing) to the actual end customer, not just the org admin. W12/W13/W14
close out rendering and observability gaps that pre-date v4 but were never
addressed. W18 keeps the frontend pass proportionate to what TDD discipline
can actually absorb this round, with the harder visual work named
explicitly as v5 rather than silently dropped.
