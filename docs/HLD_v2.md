# TrustDesk — HLD v2 (Product Extension)

**Version:** 2.0 · **Extends:** `HLD.md` (v1 remains valid; this document only adds and amends) · **Status:** Agreed baseline for LLD v2

V1 delivered the Must Have agent workflow. V2 evolves TrustDesk from "a working agent" into "a support product": the AI's work becomes visible, roles govern who does what, tickets become conversations, feedback closes the quality loop, and organizations onboard as tenants with vertical-specific policy packs.

**V2 workstreams and build order** (dependencies drove the order):

| # | Workstream | Depends on |
|---|---|---|
| W1 | UI design system + live pipeline visibility | — |
| W2 | RBAC | — |
| W3 | Feedback loop | W2 (roles scope who rates) |
| W4 | Threaded tickets + ticket status machine | W1 (thread UI on design system) |
| W5 | Multi-tenancy + vertical policy packs | W2 (admin role), W4 (schema settles first) |
| W~ | Local model tier (Ollama) | orthogonal — slot anytime |

**Compatibility guarantee:** every v1 test stays green throughout. Mechanisms: the v1 seed becomes the *default org* (vertical: retail_ecommerce); v1 single-message tickets become threads with one inbound message via backfill; v1 endpoints keep their shapes.

---

## New ADRs

### ADR-8: Pipeline visibility via Server-Sent Events (W1)
The draft/triage pipeline already runs as discrete stages (`input_scan → triage → retrieval → eligibility → draft_generation → output_scan`). V2 makes each stage emit a structured event; an SSE endpoint streams them to the frontend, which renders a live stepper per run.

- **Why SSE, not WebSockets:** one-directional server→client stream, native browser `EventSource`, no connection state to manage — the frontend never sends anything mid-run.
- **Redaction rule (agreed):** the live stream carries stage names, statuses, doc IDs, guardrail check names, and pass/fail — never draft bodies, rejected model output, or prompt content. Full details stay behind the authenticated `GET /agent-runs/:id` reviewer view (`rejected_output` is manager-visible only under RBAC).
- Events are also persisted per-run (`run_events`), so the stepper renders identically for historical runs — live and post-hoc views share one component.

### ADR-9: RBAC as route-level permission matrix (W2)
Roles (`agent`, `manager`, `admin`) already exist on `users` and in the JWT. V2 activates them with a single `requirePermission(...)` middleware backed by a static permission matrix (LLD v2 §3). Approvals/execution become manager-only, ingestion/eval/user-invites admin-only. Admin-only `POST /users/invite` replaces "no signup" as the account-creation path — still no public signup.

### ADR-10: Tickets become threads; customers still aren't users (W4)
A ticket becomes a conversation: `ticket_messages` (direction `inbound`/`outbound`) with drafts generated *per inbound message* using thread history as context. A ticket status machine governs the lifecycle:

```
open → in_progress → awaiting_customer → customer_replied → in_progress ... → resolved → closed
```

- Executing a tool action does **not** end the ticket — the outbound reply goes out, status → `awaiting_customer`.
- `resolved` is set by the human agent (AI may recommend it); `closed` after resolution (manual in v2; auto-close on inactivity is v3).
- **Customer interaction model:** no customer portal, no customer auth (v1 boundary preserved). Inbound replies arrive through an authenticated *simulation endpoint* + UI control for demos/tests. When a real channel arrives (v3: email/portal), it is an unauthenticated-channel adapter writing to the same `ticket_messages` table — the schema is already correct for it.
- Guardrail L1 runs on **every inbound message**, not just the first — a clean opening message doesn't exempt later injection attempts.

### ADR-11: Multi-tenancy — shared DB, `org_id` row scoping (W5)
- `orgs` table with `vertical ∈ {retail_ecommerce, software, finance}`; `org_id` column on every tenant-owned entity (users, customers, orders, tickets, kb_documents, drafts, tool_actions, approvals, agent_runs, eval_runs, feedback).
- JWT gains an `org_id` claim; a tenancy middleware injects it into every repository query — no query runs unscoped (enforced by repo-layer design + tests, LLD v2 §6).
- **Vertical policy packs:** onboarding an org (`POST /orgs`, admin) copies a starter KB pack for its vertical — templated policy docs (refund/shipping/warranty/billing/security for retail; license/subscription/refund-terms for software; dispute/chargeback/KYC-verification for finance). Packs are authored once as templates and stamped with org-scoped doc IDs (`{ORG}-KB-REFUND-001`).
- **The v1 seed becomes `org_default`** (vertical retail_ecommerce). All v1 tests and eval cases run against it unchanged; the eval runner stays org-scoped.
- Schema-per-tenant was rejected: migration and test cost outweighs isolation benefit at this scale.

### ADR-12: Three model tiers behind the same adapter (W~)
| Tier | Adapter | Used for | Deterministic? |
|---|---|---|---|
| Mock | `MockModelAdapter` | unit + integration tests, CI | yes — stays the CI backbone |
| Local | Ollama (`llama3.2:3b` or `qwen2.5:3b`) via `OPENAI_BASE_URL=http://localhost:11434/v1` | dev smoke runs, free adversarial probing | no — therefore **never in CI gates** |
| Hosted | OpenRouter | live demo, deployment | no |

Selection is pure configuration (`MODEL_TIER` env) — the OpenAI-compatible client is identical for local and hosted. A separate `npm run smoke:local` script runs the demo scenarios against Ollama and reports, without failing the build.

### ADR-13: One design system, built first (W1)
UI is refined once, at the start: a small design system (theme tokens, layout shell, shared components — Table, Stepper, StatusBadge, DiffPanel, Modal) that all v2 views are built on. Rationale: W1's pipeline stepper, W2's role-aware views, W4's thread view, and W5's org switcher all need the same primitives; styling them after the fact would mean rebuilding four screens. Stack: Tailwind + a headless component set; visual language specified in LLD v2 §8.

---

## Amended sections

- **§3 Components:** add `PipelineEventBus` (in-process emitter → SSE + `run_events` persistence), `OrgService` (onboarding, policy-pack stamping), `MessageService` (thread CRUD, simulation inbound), `FeedbackService`. `DraftService` becomes message-aware (context = thread history, fenced per message).
- **§5 Guardrails:** unchanged in design; scope extends — L1 per inbound message, L3's `unrelated_customer` check becomes org-aware (any customer data from another org in a draft is an automatic fail).
- **§8 Roadmap:** items 1, 2, 4 (RBAC, feedback, draft lifecycle states) move from roadmap into v2 scope. V3 roadmap: real channel ingestion (email/portal adapter), auto-close policies, policy versioning + replay, cost controls per org, red-team dashboard.

## V2 traceability (capstone rubric)

W2 (RBAC), W3 (feedback), W1 observability depth, and richer draft states are exactly the problem statement's Good To Have list; W5 (multi-tenant) and parts of W4 are its Stretch list. V2 therefore strengthens the submission without touching the frozen Must Have surface.
