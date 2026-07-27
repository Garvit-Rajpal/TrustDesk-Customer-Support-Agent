# TrustDesk

An AI support-operations tool: ticket triage, retrieval-grounded draft
replies with citations, one approval-gated tool action with idempotency,
prompt-injection/secret-leak guardrails, minimal audit traces, and an eval
runner over the provided adversarial test cases.

Core principle: **the model proposes, deterministic code disposes.** Every
model output is validated against schemas and catalogs before it can affect
state. See `docs/HLD.md` for the full architecture and rationale, `docs/LLD.md`
for exact schemas/contracts, and `docs/PROGRESS.md` for a running log of
build decisions.

## Stack

Node.js 20, Express, TypeScript (strict), PostgreSQL 16, zod, vitest +
supertest, node-pg-migrate, OpenRouter behind a `ModelAdapter` interface.
Frontend: Vite + React (separate npm project in `frontend/`).

## Setup

```bash
docker compose up -d      # Postgres 16, creates both trustdesk + trustdesk_test DBs
cp .env.example .env      # defaults work as-is for local dev
npm install
npm run migrate           # apply schema to the dev DB
npm run migrate:test      # apply schema to the test DB
npm run seed              # load data/ (customers, orders, tickets, KB docs, tool catalog, demo users)
```

Run the test suite (needs the test DB migrated, per above):

```bash
npm test                  # full suite — 191 tests across unit/integration/e2e
npm run typecheck
```

Run the app:

```bash
npm run dev                # API on :3000 (tsx watch)
npm run dev:frontend        # separate terminal — UI on :5173, proxies API calls to :3000
```

Demo login: `agent1` / `agent123` (role `agent`), `manager1` / `manager123`
(role `manager`) — see [Environment variables](#environment-variables) to
override the demo passwords.

For a guided walkthrough (the three required scenarios + eval report), see
**`docs/DEMO_SCRIPT.md`**. For a already-generated report, see
**`docs/eval_report.md`**.

## Environment variables

| Variable | Purpose | Required? |
|---|---|---|
| `DATABASE_URL` | Dev Postgres connection string | yes |
| `DATABASE_URL_TEST` | Test Postgres connection string — tests always use this, never `DATABASE_URL` | yes |
| `JWT_SECRET` | HS256 signing secret for auth tokens | yes |
| `OPENAI_API_KEY` | OpenRouter API key | no — falls back to `MockModelAdapter` demo scenarios if unset |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL (OpenRouter) | no — defaults to `https://openrouter.ai/api/v1` |
| `MODEL_NAME` | Model identifier passed to OpenRouter | no — defaults to `openrouter/auto` |
| `PORT` | API port | no — defaults to `3000` |
| `SEED_AGENT_PASSWORD` / `SEED_MANAGER_PASSWORD` | Override the demo account passwords | no |

`.env` is never committed; `.env.example` is kept current.

## Loading data

`npm run seed` reads everything under `Solution/data/` (copied from the
requirements repo so this repo is standalone — never referenced by relative
path outside this directory): `customers.json`, `orders.json`,
`tickets.json`, `tool_actions.json`, `data/knowledge_base/*.md`. It's
idempotent (upserts by ID/checksum) — safe to re-run any time, including
against a database that already has data. Seed-only expected labels from
`tickets.json` (`expected_category`, etc.) land in a physically separate
`ticket_expected_labels` table that only the seed loader and the eval
scorer ever touch — no runtime service can accidentally join against it.

## API overview

All responses use the envelope `{ data }` on success or
`{ error: { code, message, details } }` on failure. Every route below
except `/auth/login` requires `Authorization: Bearer <token>`.

| Method & path | Purpose |
|---|---|
| `POST /auth/login` | Verify credentials, issue an 8h JWT |
| `POST /documents/ingest` | Upsert KB docs by `doc_id` (checksum-skipped if unchanged) |
| `GET /documents/search?q=&category=` | Ranked full-text search over KB docs |
| `GET /documents` / `GET /documents/:docId` | List / fetch a KB doc |
| `GET /tickets?status=&category=` / `GET /tickets/:id` | Ticket queue / detail (+ customer/order context) |
| `POST /tickets` | Create a ticket (demo) |
| `POST /tickets/:id/triage` | Classify category/priority/sentiment/escalation |
| `POST /tickets/:id/draft-reply` | Generate a cited, guardrailed draft reply (409 if not yet triaged) |
| `POST /tool-actions` | Request a catalog-validated, idempotent tool action |
| `POST /tool-actions/:id/approve` / `/reject` | Human decision on an approval-gated action |
| `POST /tool-actions/:id/execute` | Execute an approved action (idempotent replay if already executed) |
| `GET /agent-runs/:runId` | Fetch a full trace (retrieved docs, guardrail results, rejected output) |
| `POST /eval-runs` | Run all or selected `data/eval_cases.jsonl` cases through the live pipeline |
| `GET /eval-runs/:id` | Fetch a stored eval report |

Full request/response contracts: `docs/LLD.md` §4.

## Running evals

```bash
npm run dev   # separate terminal
curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"agent1","password":"agent123"}'
curl -s -X POST localhost:3000/eval-runs -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' -d '{}'
```

Or from the frontend: **Eval report** tab → **Run all eval cases**. Or as
part of the automated suite: `tests/integration/evalRunner.test.ts` asserts
the exact metrics against a hand-computed expectation.

The eval runner (`src/services/evalRunner.ts`) runs every case through the
**same production `runTriage`/`generateDraft` pipeline** the API uses —
there's no separate scoring-only code path, so a passing eval genuinely
reflects the live system's behavior.

## Architecture, in brief

- **Guardrails, three layers** (`docs/HLD.md` §5): L1 input scan (pattern
  detectors over ticket text — injection phrases, secret-extraction asks,
  verification-bypass asks — force escalation, never block triage). L2
  prompt structure (untrusted content always fenced in delimited data
  blocks in every LLM call). L3 output scan (5 deterministic checks after
  every draft; 4 are fail-closed — discard the model's draft entirely and
  substitute a code-authored template — one, `action_validity`, only strips
  invalid actions and keeps the draft).
- **Guardrails are generic, never ID-based** (ADR-7): nothing anywhere
  blacklists `KB-ADVERSARIAL-001` specifically. Detection is by content
  pattern (secret-format regexes, n-gram overlap against any
  non-standard-audience doc) and structural rule (citations must be a
  subset of retrieved doc IDs), so an unknown future adversarial document
  would be caught the same way.
- **`requires_human_approval` comes only from `tool_catalog`**, never from
  model output or the client payload (invariant #1) — this is what defeats
  a "don't tell the reviewer" injection even if it reaches the tool-request
  layer.
- **Policy-window math is deterministic and uses only `ticket.created_at`**
  (`src/services/eligibility.ts`), never `Date.now()`, never the LLM.
- **Idempotency**: `tool_actions.idempotency_key` is a DB-level `UNIQUE`
  constraint; a repeated request returns the stored result (`replayed: true`)
  rather than re-executing, with a race-safe fallback if two requests with
  the same key land concurrently.
- **`ModelAdapter` interface** (ADR-3): `MockModelAdapter` (every test, and
  the app's default demo scenarios) and `OpenRouterAdapter` (used only when
  `OPENAI_API_KEY` is set) share one interface — nothing else in the
  codebase imports an AI HTTP client.

## Known limitations

- **Frontend is intentionally minimal** — HLD scopes it as "simple; JSON
  panels acceptable; polish not graded." The tool-action payload is a raw
  editable JSON textarea rather than a generated per-tool form (the
  frontend doesn't load the tool catalog's `required_fields`).
- **Retrieval is Postgres full-text search**, not embeddings/hybrid —
  explicitly acceptable per the requirements ("Do I need a vector
  database? No"). `RetrievalService` is an interface seam so this can be
  swapped later without touching callers (ADR-2).
- **Eval runner always executes synchronously.** LLD allows an
  async/202-and-poll mode above some case-count threshold; with only 8
  seed eval cases, that machinery would go unused, so it wasn't built.
  `GET /eval-runs/:id` still works for re-fetching a completed run.
- **Only one approval-gated action lifecycle is exercised end-to-end in the
  demo script** (`create_replacement_order`), per Must-Have scope — the
  other 5 catalog tools are implemented and validated identically, just
  not walked through in the demo narrative.
- **No RBAC enforcement** — `users.role` exists and is issued as a JWT
  claim, but no route currently restricts by role (explicitly Good-To-Have
  per the requirements; every seeded account can call every route).
- **No draft edit/approve/send lifecycle** — `drafts.status` supports it in
  schema, but only `generated` is ever written; sending a reply is a manual
  human step outside the system, as scoped.
- **Citation coverage is 75%, not 100%, in the default eval report** — by
  design, not a defect. See `docs/eval_report.md` for the full explanation:
  the two adversarial cases' mock drafts genuinely attempt the attack, and
  the guardrail fail-closing them costs their citation but proves the
  defense.
- **No committed migration for a `feedback` table workflow** — the table
  exists (LLD §2, "designed now, built in Good-To-Have phase") but no
  endpoint reads or writes it.

## Repository structure

```
Solution/
  docs/            HLD.md, LLD.md, ticket_lifecycle.mermaid, DEMO_SCRIPT.md, eval_report.md
  data/            copied seed data (never referenced outside this repo)
  src/
    api/           routers, middleware (auth, errors)
    services/      triage, draft, retrieval, eligibility, guardrails, toolActions, evalRunner, prompts
    adapters/      modelAdapter.ts, mock.ts, openrouter.ts, createModelAdapter.ts
    db/            migrations, repos, seed loader
    domain/        zod schemas + inferred TS types (single source of truth)
  frontend/        Vite + React SPA — queue, ticket view, action panel, eval report
  tests/           unit, integration, e2e (MockModelAdapter throughout)
```
