# TrustDesk — Implementation Context for Claude Code

AI support-operations capstone. All design decisions are already made — do not re-litigate them, implement them.

## Read before any work

1. `docs/HLD.md` — v1 architecture, ADRs 1–7, the four lifecycles, guardrail layers
2. `docs/LLD.md` — v1 DB schemas, zod domain types, API contracts, guardrail rules, prompt templates
3. `docs/HLD_v2.md` + `docs/LLD_v2.md` — v2 product extension (ADRs 8–13): pipeline visibility SSE, RBAC, feedback, threaded tickets, multi-tenancy, model tiers, design system. Delta docs — v1 remains valid where not amended.
4. `docs/HLD_v3.md` + `docs/LLD_v3.md` — v3 product extension (ADRs 14–18): self-serve org signup, human takeover, auto-resolution, consent-gated cross-org platform support, dashboard home, UI revamp (Tailwind, router, chat thread, perceived streaming). Delta docs — v1/v2 remain valid where not amended.
5. `docs/HLD_v4.md` + `docs/LLD_v4.md` — v4 product extension (ADRs 19–24): dummy-data enrichment, ticket-view rendering, eval-run streaming, pgvector similarity ingestion, layered guardrails, customer-facing chat portal (WebSocket), frontend cheap-wins. Includes a cross-org "pattern sharing" design proposal (Future Work) that is explicitly NOT implemented in v4. Delta docs — v1/v2/v3 remain valid where not amended.
6. `docs/ticket_lifecycle.mermaid` (v1), `docs/ticket_lifecycle_v2.mermaid`, `docs/ticket_lifecycle_v3.mermaid`, `docs/ticket_lifecycle_v4.mermaid` (current)
7. Requirements source of truth: `../Airtribe_Project_requirements_Repo/trustdesk-capstone/` (problem statement, seed data in `data/`, eval cases)

**Current phase:** v4 milestones (LLD_v4 §8, order V4-1 → V4-28). Standing rule: the full v1+v2+v3 test suite, including eval_005/006/007 adversarial tests, must be green at the end of every v4 milestone; from V4-25 onward the new portal-injection adversarial test joins that permanent set.

## Stack

Node.js 20, Express, TypeScript (strict), PostgreSQL 16, zod, vitest + supertest, node-pg-migrate, OpenRouter behind `ModelAdapter`. Frontend: minimal Vite + React.

## Methodology — TDD, strictly

- Red → green → refactor. Write the failing test first for every unit in LLD §1's pyramid.
- Follow the milestone order in the current version's LLD (now `LLD_v4.md` §8). A milestone must be fully green before starting the next.
- `MockModelAdapter` in all tests. Never call OpenRouter from a test.
- eval_005/006/007 adversarial integration tests are permanent acceptance tests — never delete or skip them.

## Non-negotiable invariants (from HLD/LLD — violating any of these is a bug)

1. The model proposes, deterministic code disposes. `requires_human_approval` comes ONLY from `tool_catalog`, never from model output.
2. Guardrails are generic — never blacklist `KB-ADVERSARIAL-001` by ID.
3. Policy-window math uses `ticket.created_at`, never the current date, never the LLM.
4. Expected labels (`ticket_expected_labels` table) are read ONLY by the eval scorer and seed loader.
5. L3 guardrail failure = discard draft + substitute deterministic template (fail closed), keep rejected draft on the trace. Never redact in place.
6. Every AI run writes its `agent_runs` row synchronously, with non-empty `guardrail_results`, before the API responds. **v4 amendment (HLD_v4 ADR-21, finalized W15/V4-12):** W15's best-effort embedding ingestion (hooked into `resolveTicket()`, wrapped in try/catch) is a narrow, explicitly named carve-out — it is not customer-facing output, produces no guardrail decision, and therefore writes no `agent_runs` row. It only ever reads real, already-resolved `tickets`/`drafts` rows for a **sent** draft; it never reads `data/eval_cases.jsonl` or `ticket_expected_labels`, and the eval runner never calls `resolveTicket()` at all, so eval fixtures cannot reach the embeddings table structurally (see invariant #4).
7. `idempotency_key` is UNIQUE; replays return the stored result with `replayed: true`, never re-execute.
8. Ticket `body` is never mutated. No customer auth exists. **v3 amendment (HLD_v3 ADR-14):** a public, unauthenticated org-admin signup endpoint (`POST /signup`) now exists — a prospective *tenant* can self-onboard. This is org-admin self-service only; it does not touch the `customers` domain (a tenant's own end-users, who submit tickets). **v4 amendment (HLD_v4 ADR-23, finalized W17/V4-25):** the sentence "end-customer auth/signup still does not exist and is not planned" is now stale. A new, deliberately lightweight, **non-account** customer verification exists: `POST /customer-auth/verify` (public, unauthenticated, rate-limited 5/hour/IP — stricter than `/signup`'s 10/hour) confirms ownership of an order or ticket via `org_slug` + `email` + exactly one of `order_id`/`ticket_id` — no password, no persistent login. On success it issues a `CustomerToken` (`{customer_id, org_id, ticket_id?, kind: "customer"}`, 1h expiry, `src/domain/authTypes.ts`) with **no `Role`**, so `requirePermission()` rejects it on every existing agent/admin route by construction, not by an added check (`tests/e2e/customerAuth.test.ts` asserts both directions: an agent JWT is rejected wherever a `CustomerToken` is expected, and vice versa). `customerAuthMiddleware` (`src/api/middleware/customerAuthMiddleware.ts`) exists to guard any REST route on this surface the same way `authMiddleware` guards agent routes; the customer-chat WS handshake (`src/ws/customerChatServer.ts`, attached to the raw `http.Server` in `server.ts` only — never `app.ts`, so no test importing `app` can reach it) verifies the same `CustomerToken` inline instead of through that middleware, since a WS upgrade never enters the Express middleware chain — same `verifyCustomerToken()` call, same rejection outcome (closes the socket, code 4001), still never `requirePermission()`. `/portal/*` itself is a purely client-side React Router path (`frontend/src/portal/`) with no matching Express route — the actual new backend surface is `POST /customer-auth/verify` and the `/customer-chat` WS endpoint. A customer-authored thread message is attributed to the verified `customer_id` (via `receiveCustomerMessage()`, structurally identical to `simulateInbound()` including its eager L1 scan), never conflated with an agent's `user_id` or the literal string `"customer"` that `simulateInbound()` still uses. This is a narrowly scoped capability addition — there is still no customer *account* system, no customer password, and no customer access to any other customer's or any agent's data.
9. Draft-reply requires prior triage (409 otherwise) — enforces triage → retrieval → draft. **v3 amendment:** draft-reply also 409s once a ticket is `human_owned` (see invariant 11).
10. Auto-send eligibility (`evaluateAutoSend()`, HLD_v3 ADR-15) is deterministic code keyed on `resolution_type`/`recommended_actions`, never model output — the send decision follows invariant #1's rule exactly, just applied one step further down the pipeline.
11. Once a ticket is `human_owned` (a human agent sent a manually-composed reply via `POST /tickets/:id/messages/reply`), AI drafting is permanently blocked for that ticket — one-way, no revert path in v3.

## Conventions

- Enum values: zod schemas in `src/domain/` are the single source of truth; DB mirrors them via CHECK constraints.
- API envelope: `{ data }` success, `{ error: { code, message, details } }` failure — codes in LLD §4.
- IDs: `usr_|act_|apr_|run_|draft_|eval_run_` + nanoid. Seed IDs (`tkt_9001`, `KB-REFUND-001`) preserved verbatim.
- Explain non-obvious decisions in code comments referencing the ADR/LLD section (the project owner is learning from this codebase).

## Commands (once bootstrapped)

- `npm test` — full suite (must be green before any commit)
- `npm run test:unit` / `test:integration`
- `npm run migrate` / `npm run seed`
- `npm run dev` — API; `npm run dev:frontend`

## Environment

- `DATABASE_URL`, `DATABASE_URL_TEST`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` (OpenRouter endpoint, OpenAI-compatible), `JWT_SECRET`, `MODEL_NAME` in `.env` (never committed; keep `.env.example` current)
- V4-10: `EMBEDDING_TIER` (mock/local/hosted, mirrors `MODEL_TIER`), `EMBEDDING_MODEL_NAME`, `EMBEDDINGS_API_KEY`/`EMBEDDINGS_BASE_URL` (hosted tier only — distinct credential from `OPENAI_API_KEY`, which points at OpenRouter and has no embeddings endpoint)
