# TrustDesk — LLD v2

**Version:** 2.0 · **Extends:** `LLD.md` · **Parent:** `HLD_v2.md` · TDD methodology (LLD v1 §1) applies unchanged to every v2 milestone.

Delta document: only new/changed contracts appear here.

---

## 1. Schema Changes (new migrations; existing tables altered, never rebuilt)

```sql
-- W5 (created early as a no-op so later migrations can reference it)
CREATE TABLE orgs (
  org_id     text PRIMARY KEY,             -- 'org_' + nanoid; seed = 'org_default'
  name       text NOT NULL,
  vertical   text NOT NULL CHECK (vertical IN ('retail_ecommerce','software','finance')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- W1: persisted pipeline events (SSE replays from here for historical runs)
CREATE TABLE run_events (
  event_id  bigserial PRIMARY KEY,
  run_id    text NOT NULL REFERENCES agent_runs,
  stage     text NOT NULL CHECK (stage IN
            ('input_scan','triage','retrieval','eligibility','draft_generation','output_scan')),
  status    text NOT NULL CHECK (status IN ('started','completed','failed','blocked')),
  summary   jsonb NOT NULL DEFAULT '{}',   -- REDACTED payload only: doc_ids, check names, pass/fail
  created_at timestamptz NOT NULL DEFAULT now()
);

-- W4: threads
CREATE TABLE ticket_messages (
  message_id text PRIMARY KEY,             -- 'msg_' + nanoid
  ticket_id  text NOT NULL REFERENCES tickets,
  direction  text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body       text NOT NULL,                -- immutable after insert (same rule as v1 ticket body)
  author     text NOT NULL,                -- 'customer' | user_id for outbound
  draft_id   text REFERENCES drafts,       -- outbound messages link the draft they were sent from
  created_at timestamptz NOT NULL DEFAULT now()
);

-- W4: ticket status machine (replaces free-text status)
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK (status IN
  ('open','in_progress','awaiting_customer','customer_replied','resolved','closed'));

ALTER TABLE drafts ADD COLUMN message_id text REFERENCES ticket_messages;  -- inbound msg it answers

-- W3: feedback table exists from v1; activate + extend
ALTER TABLE feedback ADD COLUMN reviewer_id text REFERENCES users,
  ADD CONSTRAINT feedback_rating_check CHECK (rating BETWEEN 1 AND 5);

-- W5: org scoping (one migration, nullable-then-backfill-then-NOT NULL pattern)
ALTER TABLE users     ADD COLUMN org_id text REFERENCES orgs;
ALTER TABLE customers ADD COLUMN org_id text REFERENCES orgs;
-- ...same for orders, tickets, kb_documents, drafts, tool_actions, approvals,
--    agent_runs, eval_runs, feedback; backfill all to 'org_default'; then SET NOT NULL.
-- kb doc IDs remain globally unique because pack stamping prefixes them ('{ORG}-KB-REFUND-001');
-- org_default keeps unprefixed v1 IDs so v1 evals/tests are untouched.
CREATE INDEX ON tickets (org_id, status);
CREATE INDEX ON kb_documents (org_id);
```

**Backfill migration (W4):** for every existing ticket, insert one `inbound` `ticket_messages` row from `tickets.body` (created_at = ticket.created_at); link existing drafts' `message_id` to it. `tickets.body` is retained (audit invariant) but new code reads the thread.

---

## 2. W1 — Pipeline Visibility

**Event flow:** each pipeline stage calls `events.emit(runId, stage, status, summary)` → `PipelineEventBus` (in-process `EventEmitter`) → (a) SSE broadcast, (b) async insert into `run_events`.

**`GET /tickets/:id/runs/:runId/events` (SSE)** — `Content-Type: text/event-stream`; replays persisted events first, then live-streams. Event body = `{ stage, status, summary, ts }`.

**Redaction contract (unit-tested):** `summary` may contain only: `doc_ids`, `check`, `passed`, `category`, `resolution_type`, counts, durations. A `redactSummary()` function is the single gate; test asserts draft bodies / prompt text / rejected output can never pass through it.

**Frontend:** `<RunStepper>` renders the six stages from the event stream; identical component for live and historical runs. Failure/blocked stages link to the run detail view (role-gated per W2).

## 3. W2 — RBAC Permission Matrix

| Permission | agent | manager | admin |
|---|---|---|---|
| view tickets/runs/drafts, search KB | ✓ | ✓ | ✓ |
| triage, draft, request tool action, simulate inbound | ✓ | ✓ | ✓ |
| approve/reject/execute tool actions | — | ✓ | ✓ |
| view `rejected_output` on traces | — | ✓ | ✓ |
| resolve/close tickets | ✓ | ✓ | ✓ |
| submit feedback | ✓ | ✓ | ✓ |
| ingest documents, run evals | — | — | ✓ |
| invite users (`POST /users/invite`), onboard orgs | — | — | ✓ |

Implementation: static `PERMISSIONS` map (`permission → roles[]`), `requirePermission('actions:approve')` middleware reads role from JWT. 403 `FORBIDDEN` envelope on failure. Tests: one table-driven test iterating every route × role.

## 4. W3 — Feedback

- `POST /drafts/:id/feedback` `{ rating (1–5), reason?, corrected_response? }`, reviewer from JWT. One feedback per reviewer per draft (unique index) — repeat submissions update.
- `GET /metrics/agent-quality` → `{ draft_acceptance_rate, action_approval_rate, avg_rating, guardrail_block_rate, by_category: {...} }` computed from drafts/approvals/feedback/agent_runs. Manager+.
- Frontend: rating control on draft panel; quality dashboard page.

## 5. W4 — Threads

**API additions**

| Endpoint | Behavior |
|---|---|
| `GET /tickets/:id/messages` | full thread, ordered |
| `POST /tickets/:id/messages/simulate-inbound` `{ body }` | demo/test control: appends inbound msg, status → `customer_replied`, runs L1 input scan on it (result stored on next run) |
| `POST /drafts/:id/send` | appends outbound message from draft, draft status → `sent`, ticket status → `awaiting_customer` |
| `POST /tickets/:id/resolve` · `/close` | status transitions below; human-only |

**Status machine (transitions enforced in `TicketService`; illegal → 409):**

```
open → in_progress                (first triage or agent opens it)
in_progress → awaiting_customer   (draft sent)
awaiting_customer → customer_replied  (inbound message)
customer_replied → in_progress    (agent re-runs pipeline)
in_progress|awaiting_customer → resolved   (human)
resolved → closed                 (human; v3: auto-close)
resolved → customer_replied       (customer reopens by replying)
```

**Draft pipeline changes:** draft targets the **latest inbound message**; prompt context = eligibility facts + retrieved docs + **thread history**, each message individually fenced as untrusted data with direction labels. Triage may be re-run after each inbound message (category can shift mid-thread — e.g. shipping complaint becomes refund demand); latest triage governs tool allowability. L1 runs on every inbound message (ADR-10).

**Lifecycle semantics (agreed):** executed action → agent sends reply → `awaiting_customer`. Ticket ends only at `closed`. "One reply per ticket" is retired.

## 6. W5 — Multi-tenancy

- **Auth:** JWT adds `org_id`; login response includes org. Admins belong to an org (cross-org platform admin is v3).
- **Scoping enforcement:** every repository method takes an `OrgContext` as its first argument — there is no unscoped variant exported. Tenancy middleware builds the context from the JWT. Test: a dedicated integration suite seeds two orgs and asserts every list/fetch/search/eval endpoint returns zero cross-org rows.
- **`POST /orgs`** (admin) `{ name, vertical }` → creates org + stamps the vertical's policy pack (`src/policy_packs/{vertical}/*.md`, doc IDs prefixed `{ORG}-`) + creates the org's first admin invite.
- **Policy packs:** authored as templates in-repo. retail_ecommerce = generalized v1 docs; software = license/subscription/refund-terms/security; finance = disputes/chargebacks/KYC-verification/security. Each pack includes the security playbook equivalent (guardrail evals need a citable security doc per org).
- **Eval runner:** scoped to `org_default` (the only org with seeded eval cases); v1 metrics unchanged.

## 7. W~ — Local Model Tier

- `MODEL_TIER = mock | local | hosted` selects adapter config at boot; `local` sets the OpenAI-compatible client to `http://localhost:11434/v1` (Ollama), model from `MODEL_NAME` (default `qwen2.5:3b`).
- `npm run smoke:local`: runs the 7-step demo flow (tkt_9001 happy path + tkt_9006 adversarial) against the local tier, prints a pass/warn report. **Not part of `npm test`** — non-deterministic tiers never gate CI.
- Docs: `README` section on installing Ollama + pulling the model.

## 8. W1 — UI Design System (built first, everything renders on it)

- Tailwind + headless primitives. Tokens: neutral surface palette, status colors mapped to domain enums (priority, ticket status, run status, guardrail pass/fail — one `StatusBadge` component reads them all).
- Layout shell: sidebar (Queue, Dashboard, Documents, Evals, Admin — items filtered by role), topbar (org name, user, logout).
- Core components: `DataTable`, `RunStepper`, `StatusBadge`, `ThreadView` (chat-style, inbound left / outbound right, draft panel inline), `ApprovalCard`, `MetricTile`, `Modal`.
- Pages: Queue · Ticket (thread + stepper + draft + actions) · Quality dashboard · Documents · Eval runs · Admin (users, org onboarding).
- Accessibility floor: keyboard navigable, visible focus, WCAG AA contrast. Polish beyond this is not a goal.

---

## 9. V2 Milestones (TDD, each green before the next)

| # | Milestone | Tests written first |
|---|---|---|
| V2-1 | Design system shell + `run_events` + `PipelineEventBus` + SSE + `RunStepper` | `redactSummary()` never leaks bodies/prompts; events persisted per stage; SSE replay = live render |
| V2-2 | RBAC middleware + permission matrix + invite flow | route × role permission table test; 403 envelopes; invite creates user in inviter's org |
| V2-3 | Feedback endpoints + quality metrics + dashboard | metric math on fixture data; unique-per-reviewer upsert |
| V2-4 | `ticket_messages` + backfill + status machine + thread-aware draft pipeline + simulate-inbound + send | backfill integrity (v1 suite still green); illegal transitions 409; L1 on every inbound msg (mid-thread injection fixture); draft cites against latest retrieval |
| V2-5 | `orgs` + org_id backfill + scoped repos + onboarding + policy packs | two-org isolation suite (zero cross-org leakage); pack stamping produces prefixed doc IDs; v1 eval metrics unchanged on org_default |
| V2-6 | Local tier config + `smoke:local` | config selection unit test; smoke script reports without gating CI |

**Standing regression rule:** the full v1 suite (including eval_005/006/007 adversarial tests) runs green at the end of every v2 milestone.
