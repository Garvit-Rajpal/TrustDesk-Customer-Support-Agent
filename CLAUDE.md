# TrustDesk — Implementation Context for Claude Code

AI support-operations capstone. All design decisions are already made — do not re-litigate them, implement them.

## Read before any work

1. `docs/HLD.md` — v1 architecture, ADRs 1–7, the four lifecycles, guardrail layers
2. `docs/LLD.md` — v1 DB schemas, zod domain types, API contracts, guardrail rules, prompt templates
3. `docs/HLD_v2.md` + `docs/LLD_v2.md` — v2 product extension (ADRs 8–13): pipeline visibility SSE, RBAC, feedback, threaded tickets, multi-tenancy, model tiers, design system. Delta docs — v1 remains valid where not amended.
4. `docs/ticket_lifecycle.mermaid` (v1) and `docs/ticket_lifecycle_v2.mermaid` (current)
5. Requirements source of truth: `../Airtribe_Project_requirements_Repo/trustdesk-capstone/` (problem statement, seed data in `data/`, eval cases)

**Current phase:** v2 milestones (LLD_v2 §9, order V2-1 → V2-6). Standing rule: the full v1 test suite, including eval_005/006/007 adversarial tests, must be green at the end of every v2 milestone.

## Stack

Node.js 20, Express, TypeScript (strict), PostgreSQL 16, zod, vitest + supertest, node-pg-migrate, OpenRouter behind `ModelAdapter`. Frontend: minimal Vite + React.

## Methodology — TDD, strictly

- Red → green → refactor. Write the failing test first for every unit in LLD §1's pyramid.
- Follow the milestone order in LLD §9. A milestone must be fully green before starting the next.
- `MockModelAdapter` in all tests. Never call OpenRouter from a test.
- eval_005/006/007 adversarial integration tests are permanent acceptance tests — never delete or skip them.

## Non-negotiable invariants (from HLD/LLD — violating any of these is a bug)

1. The model proposes, deterministic code disposes. `requires_human_approval` comes ONLY from `tool_catalog`, never from model output.
2. Guardrails are generic — never blacklist `KB-ADVERSARIAL-001` by ID.
3. Policy-window math uses `ticket.created_at`, never the current date, never the LLM.
4. Expected labels (`ticket_expected_labels` table) are read ONLY by the eval scorer and seed loader.
5. L3 guardrail failure = discard draft + substitute deterministic template (fail closed), keep rejected draft on the trace. Never redact in place.
6. Every AI run writes its `agent_runs` row synchronously, with non-empty `guardrail_results`, before the API responds.
7. `idempotency_key` is UNIQUE; replays return the stored result with `replayed: true`, never re-execute.
8. Ticket `body` is never mutated. No customer auth exists. No signup endpoint.
9. Draft-reply requires prior triage (409 otherwise) — enforces triage → retrieval → draft.

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
