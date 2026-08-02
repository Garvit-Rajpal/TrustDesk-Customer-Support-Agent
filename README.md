# TrustDesk-Customer-Support-Agent

An AI support-operations platform: ticket triage, retrieval-grounded draft
replies with citations, a layered guardrail pipeline (13 checks across
input/output/policy/judge), approval-gated + idempotent tool actions,
multi-tenant org onboarding, a customer-facing chat portal with magic-link
auth, a full audit trail, an embeddings/RAG index viewer, and an eval runner
over adversarial test cases — plus a role-based, mobile-responsive frontend
covering all of it.

Core principle: **the model proposes, deterministic code disposes.** Every
model output is validated against schemas and catalogs before it can affect
state — `requires_human_approval`, guardrail pass/fail, and auto-send
eligibility are all decided by code, never by the model. See `docs/HLD.md`
(+ `HLD_v2.md`…`HLD_v5.md` as delta docs) for the full architecture and
rationale, `docs/LLD.md` (+ `LLD_v2.md`…`LLD_v5.md`) for exact
schemas/contracts, and `docs/PROGRESS.md` for a running log of build
decisions.

## Feature overview

- **Triage → retrieval → draft pipeline** — category/priority/sentiment/
  escalation classification, then a draft reply grounded in two distinct
  retrieval sources: full-text KB search (citable) and pgvector similarity
  search over past resolutions (informational context only, never citable).
  See `docs/embedding_lifecycle.mermaid` for the full ingest/retrieve
  lifecycle.
- **13-check layered guardrail pipeline** (`docs/ticket_lifecycle_v5.mermaid`
  has the full flow with exact counts): 3 input-scan checks (injection
  phrase, secret-extraction ask, verification-bypass ask — force escalation,
  never block triage), 1 prompt-structure check (untrusted content always
  fenced in delimited blocks), 6 output-scan checks (citation subset,
  internal leak, secret leak, internal-register leak, unrelated-customer
  content, action validity), 2 org-policy-pack checks (retail/software/
  finance verticals each carry their own `guardrail_rules.json`), and 1
  conditional semantic-judge check that only runs once the other 12 have
  already passed. A failure anywhere in the output/policy layer discards the
  model's draft and substitutes a deterministic template — fail closed,
  never redacted in place.
- **Approval-gated, idempotent tool actions** — a 6-tool catalog
  (`create_replacement_order`, `start_refund_review`, `issue_coupon`,
  `open_carrier_investigation`, `escalate_to_human`, `lock_account`), each
  with a catalog-defined `requires_human_approval` flag the model can never
  override, and a DB-unique `idempotency_key` so a replayed request returns
  the stored result instead of re-executing.
- **Multi-tenancy** — self-serve org signup (`POST /signup`), org-scoped
  data isolation enforced by `tenancyMiddleware` on every authenticated
  route, and a consent-gated cross-org Platform Support view for
  `org_default` admins only.
- **RBAC** — a single static permission → roles[] policy table
  (`src/domain/permissions.ts`), enforced by `requirePermission()` on every
  route; three roles (`agent`, `manager`, `admin`) with escalating access
  (e.g. only `manager`+ can approve tool actions, only `admin` can ingest
  KB docs or run evals).
- **Customer-facing chat portal** (`/portal/*`) — no customer account
  system. Two parallel, non-password verification paths onto the same
  short-lived `CustomerToken`: a manual order/ticket-ownership form (1h
  expiry) and a magic-link email flow (30-day expiry, single-use, hashed,
  15-minute-lived opaque token, distinct from the `CustomerToken` it mints).
  Live chat runs over a WebSocket (`/customer-chat`) with the same eager
  guardrail scan every inbound message gets.
- **Human takeover & auto-resolution** — a manually-typed reply
  permanently and irreversibly blocks further AI drafting on that ticket;
  conversely, a draft whose recommended actions all skip human approval
  auto-sends with no click.
- **Audit trail & RAG visibility** — every AI run persists a synchronous
  `agent_runs` row (retrieved docs, guardrail results, rejected output,
  similar-past-resolution matches) before the API responds. The frontend
  exposes an Audit Trail table and (in `org_default` only) an Embeddings
  index viewer and the Eval report — both gated both in the API and in the
  UI, since eval fixtures and the embedding index only ever exist in the
  default org's data.
- **Eval runner** — every case in `data/eval_cases.jsonl` (including 3
  adversarial cases) runs through the exact same production
  `runTriage`/`generateDraft` pipeline the API uses, scored against
  `ticket_expected_labels` (a table only the seed loader and the scorer
  ever touch).
- **Model/embedding/email adapters, all tiered** (`mock` / `local` /
  `hosted`) — `mock` is deterministic and network-free (used by every
  automated test and this repo's default demo mode), `local` targets Ollama/
  Mailpit, `hosted` targets OpenRouter / a real embeddings API / a real
  transactional email provider. Nothing else in the codebase imports an AI,
  embedding, or email HTTP client directly.
- **Mobile-responsive frontend** — off-canvas nav drawer below the `md`
  breakpoint, horizontally-scrollable tables, responsive grids throughout;
  verified down to 390px.

## Stack

Node.js ≥22.6.0, Express, TypeScript (strict), PostgreSQL 16 with
`pgvector`, zod, vitest + supertest, node-pg-migrate, OpenRouter behind a
`ModelAdapter` interface. Frontend: Vite + React + Tailwind (separate npm
project in `frontend/`).

> **Node version note:** `npm run migrate` shells out to `node-pg-migrate
> --migration-file-language ts`, which `require()`s each `.ts` migration
> file directly with no transpiler of its own. That only works on Node
> ≥22.6.0's native TypeScript-stripping support — Node 20 fails with a raw
> syntax error. Use Docker (below) if you don't want to manage a Node 22
> install locally.

## Quickstart with Docker (recommended)

The fastest way to run the whole stack — Postgres (with `pgvector`),
backend API, and the built frontend behind nginx — with zero other setup.
Every model/embedding/email adapter defaults to its `mock` tier here, so
this needs no OpenRouter key, no local Ollama instance, and no real email
provider to produce a fully working, deterministic demo.

```bash
docker compose up --build
```

Then open **http://localhost:8080**. Migrations run and demo data seeds
automatically on first boot (`docker-entrypoint.sh`); the backend is also
reachable directly at **http://localhost:3000** and Postgres at
**localhost:5432** (`trustdesk` / `trustdesk`, DB `trustdesk`).

Demo login: `admin1` / `admin123` (role `admin`), `manager1` / `manager123`
(role `manager`), `agent1` / `agent123` (role `agent`) — just username +
password, no org field (the login form resolves the org from the username
server-side; usernames are globally unique). See `docs/DEMO_SCRIPT.md` for
a full guided walkthrough.

**Re-running vs. restarting:** migrations are safe to re-run every start
(purely additive). Seeding is deliberately *not* unconditional —
`npm run seed:if-empty` only seeds a genuinely empty `tickets` table, so
restarting the containers never resets a live demo's progress (a re-seed
would overwrite `status`/`triage` back to pristine values on every seeded
ticket). To reset to a fresh demo state, tear down the Postgres volume:

```bash
docker compose down -v   # WARNING: destroys all data, including the pg volume
docker compose up --build
```

**Using a real model/embedding/email provider instead of mock:** override
via a `.env` file at the repo root (docker compose reads it automatically)
or inline:

```bash
MODEL_TIER=hosted OPENAI_API_KEY=sk-... \
EMBEDDING_TIER=hosted EMBEDDINGS_API_KEY=... \
EMAIL_TIER=hosted EMAIL_API_KEY=... \
docker compose up --build
```

See [Environment variables](#environment-variables) for the full list and
tier semantics.

**Individual images**, if you only want one piece (e.g. just Postgres for
native dev — see below):

```bash
docker compose up -d postgres              # just the DB
docker compose build backend               # rebuild after a backend change
docker compose build --no-cache backend    # skip layer cache entirely
docker compose build --build-arg SKIP_TYPECHECK=1 backend   # faster local iteration
```

## Native setup (without Docker)

Requires Node **≥22.6.0** and a reachable Postgres 16 with the `pgvector`
extension (the `docker compose up -d postgres` command above is the
easiest way to get one without installing Postgres locally).

```bash
docker compose up -d postgres   # or point DATABASE_URL at your own Postgres 16 + pgvector
cp .env.example .env            # defaults work as-is for local dev
npm install
npm run migrate                 # apply schema to the dev DB
npm run migrate:test            # apply schema to the test DB
npm run seed                    # load data/ (customers, orders, tickets, KB docs, tool catalog, demo users)
```

Run the test suite (needs the test DB migrated, per above):

```bash
npm test                  # full suite — 626 tests across unit/integration/e2e
npm run typecheck
```

Run the app:

```bash
npm run dev                # API on :3000 (tsx watch)
npm run dev:frontend        # separate terminal — UI on :5173, proxies API calls to :3000
```

Demo login: `admin1` / `admin123`, `manager1` / `manager123`,
`agent1` / `agent123` — see [Environment variables](#environment-variables)
to override the demo passwords.

For a guided walkthrough (login, triage/draft/guardrails, adversarial
defense, human takeover, tool approvals, KB search, customer portal —
manual verify + magic link + live chat, admin onboarding, platform support,
mobile responsiveness, audit trail, embeddings/RAG index, eval report), see
**`docs/DEMO_SCRIPT.md`**. For an already-generated report, see
**`docs/eval_report.md`**.

## Environment variables

| Variable | Purpose | Required? |
|---|---|---|
| `DATABASE_URL` | Dev Postgres connection string | yes |
| `DATABASE_URL_TEST` | Test Postgres connection string — tests always use this, never `DATABASE_URL` | yes |
| `JWT_SECRET` | HS256 signing secret for auth tokens | yes |
| `PORT` | API port | no — defaults to `3000` |
| `MODEL_TIER` | `mock` \| `local` \| `hosted` — see below | no — infers `hosted` if `OPENAI_API_KEY` is set, else `mock` |
| `OPENAI_API_KEY` | OpenRouter API key | no — falls back to `MockModelAdapter` demo scenarios if unset |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL (OpenRouter) | no — defaults to `https://openrouter.ai/api/v1` |
| `MODEL_NAME` | Model identifier passed to OpenRouter/Ollama | no — defaults to `openrouter/auto` (hosted) / `qwen2.5:3b` (local) |
| `OPENAI_BASE_URL_LOCAL` | Ollama's OpenAI-compatible base URL | no — defaults to `http://localhost:11434/v1` |
| `EMBEDDING_TIER` | `mock` \| `local` \| `hosted` — mirrors `MODEL_TIER` | no — infers `hosted` only from `EMBEDDINGS_API_KEY`, never `OPENAI_API_KEY` |
| `EMBEDDING_MODEL_NAME` | Embedding model identifier | no — defaults to `nomic-embed-text` (local tier) |
| `EMBEDDINGS_API_KEY` / `EMBEDDINGS_BASE_URL` | Hosted-tier embeddings API credentials — distinct from `OPENAI_API_KEY` | no |
| `EMAIL_TIER` | `mock` \| `local` \| `hosted` — mirrors `EMBEDDING_TIER` | no — infers `hosted` only from `EMAIL_API_KEY` |
| `EMAIL_BASE_URL` | Local-tier mail catcher base URL (e.g. Mailpit) | no — defaults to `http://localhost:8025` |
| `EMAIL_API_KEY` | Hosted-tier transactional email provider key | no |
| `EMAIL_FROM_ADDRESS` | `From:` header for magic-link emails | no — defaults to `TrustDesk <no-reply@trustdesk.example>` |
| `PORTAL_BASE_URL` | Externally-reachable frontend origin, used to build the absolute magic-link URL in emails | no — defaults to `http://localhost:5173` (native dev) / set to `http://localhost:8080` under Docker |
| `SEED_AGENT_PASSWORD` / `SEED_MANAGER_PASSWORD` / `SEED_ADMIN_PASSWORD` | Override the demo account passwords | no |

`.env` is never committed; `.env.example` is kept current.

### Model / embedding / email tiers

All three adapters follow the same `mock` / `local` / `hosted` pattern —
each is resolved once at boot by a `createXAdapter(env)` function that
infers `hosted` from that adapter's own distinct API-key env var (never a
different adapter's key) and otherwise defaults to `mock`.

- **`mock`** — deterministic, canned responses, no network. Used by every
  automated test and the default demo/Docker configuration.
- **`local`** — a locally-running open service: Ollama for models/
  embeddings, Mailpit for email. No API key required.
- **`hosted`** — a real external provider: OpenRouter (models), a hosted
  embeddings API, a transactional email provider (e.g. Resend). Requires
  the corresponding `*_API_KEY`.

To try the local model tier:

```bash
brew install ollama        # or see ollama.com/download
ollama serve                # separate terminal, or use the installed background service
ollama pull qwen2.5:3b      # ~2GB download, matches MODEL_NAME's default
MODEL_TIER=local npm run dev
```

`npm run smoke:local` runs the same happy-path (tkt_9001) + adversarial
(tkt_9006) flow as `docs/DEMO_SCRIPT.md`, straight through the API layer
(no browser needed), against whatever DB `DATABASE_URL` points at — run
`npm run seed` first if it's empty. It prints a per-step PASS/WARN/FAIL
report and always exits 0 on a completed run: a small local model's exact
wording is expected to vary, so only the deterministic invariants (forced
escalation on the injection attempt, catalog-gated approval, no
unapproved coupon action) are hard requirements. **It is intentionally not
part of `npm test`** — non-deterministic model tiers never gate CI.

## Loading data

`npm run seed` reads everything under `Solution/data/` (copied from the
requirements repo so this repo is standalone — never referenced by
relative path outside this directory): `customers.json`, `orders.json`,
`tickets.json`, `tool_actions.json`, `data/knowledge_base/*.md`. It's
idempotent (upserts by ID/checksum) — safe to re-run any time, including
against a database that already has data. **Note:** re-running `npm run
seed` resets any seeded ticket's `status`/`triage` back to its pristine
seed value (the `ON CONFLICT DO UPDATE` includes those columns) — this is
why the Docker entrypoint uses `npm run seed:if-empty` instead, which only
seeds a genuinely empty database. Seed-only expected labels from
`tickets.json` (`expected_category`, etc.) land in a physically separate
`ticket_expected_labels` table that only the seed loader and the eval
scorer ever touch — no runtime service can accidentally join against it.

## API overview

All responses use the envelope `{ data }` on success or
`{ error: { code, message, details } }` on failure. Every route below
except `POST /auth/login`, `POST /signup`, and the `/customer-auth/*`
routes requires `Authorization: Bearer <token>`; role requirements are
enforced by `requirePermission()` per `src/domain/permissions.ts`.

| Method & path | Purpose |
|---|---|
| `POST /auth/login` | Verify credentials, issue an org-scoped JWT |
| `POST /signup` | Self-serve org onboarding (public, rate-limited) |
| `POST /customer-auth/verify` | Manual order/ticket-ownership check → 1h `CustomerToken` (public, rate-limited) |
| `POST /customer-auth/magic-link/request` | Email a one-time login link (public, rate-limited, per-customer abuse guard) |
| `POST /customer-auth/magic-link/consume` | Exchange a magic-link token → 30-day `CustomerToken`, single-use |
| `WS /customer-chat` | Live customer chat, verified via the same `CustomerToken` |
| `GET /tickets?status=&category=` / `GET /tickets/:id` | Ticket queue / detail (+ customer/order context) |
| `POST /tickets` | Create a ticket |
| `POST /tickets/:id/triage` | Classify category/priority/sentiment/escalation |
| `POST /tickets/:id/draft-reply` | Generate a cited, guardrailed draft reply (409 if not yet triaged, or if `human_owned`) |
| `GET /tickets/:id/messages` | Thread messages |
| `POST /tickets/:id/messages/simulate-inbound` | Demo/test stand-in for an inbound customer reply |
| `POST /tickets/:id/messages/reply` | Human takeover — manual reply, marks the ticket `human_owned` permanently |
| `POST /tickets/:id/resolve` / `/close` | Human-only lifecycle transitions |
| `GET /tickets/:id/runs/:runId/events` | SSE stream of pipeline stage events for one run |
| `POST /drafts/:id/send` | Send a generated draft to the customer |
| `POST /drafts/:id/feedback` | Submit thumbs up/down feedback on a draft |
| `POST /tool-actions` | Request a catalog-validated, idempotent tool action |
| `POST /tool-actions/:id/approve` / `/reject` | Human decision on an approval-gated action (`manager`+) |
| `POST /tool-actions/:id/execute` | Execute an approved action (idempotent replay if already executed) |
| `GET /agent-runs/:runId` | Fetch a full trace (retrieved docs, similar resolutions, guardrail results, rejected output) |
| `POST /documents/ingest` | Upsert KB docs by `doc_id` (checksum-skipped if unchanged, `admin` only) |
| `GET /documents/search?q=&category=` | Ranked full-text search over KB docs |
| `GET /documents` / `GET /documents/:docId` | List / fetch a KB doc |
| `GET /embeddings` | List the resolution-embedding index (`org_default` only) |
| `POST /eval-runs` / `/eval-runs/start` | Run all or selected `data/eval_cases.jsonl` cases through the live pipeline (`admin` only, `org_default` only) |
| `GET /eval-runs/:id` | Fetch a stored eval report (`org_default` only) |
| `GET /eval-runs/:runId/events` | SSE stream of eval-run progress (`org_default` only) |
| `GET /metrics/agent-quality` | Aggregate quality metrics (`manager`+) |
| `GET /dashboard/summary` | Dashboard home KPIs |
| `POST /customers` / `GET /customers` | Create / list customers |
| `GET /customers/:id/orders` | A customer's order history |
| `POST /users/invite` | Invite a new org user (`admin` only) |
| `POST /orgs` | Create an org (`admin` role, and only for `org_default` — the platform tenant) |
| `GET /orgs/consent` / `PUT /orgs/consent` | Manage this org's cross-org platform-support consent flags (`admin` only) |
| `GET /platform/tickets` / `GET /platform/tickets/:id/messages` / `GET /platform/metrics` | Cross-org support views — `org_default` only, and only for orgs that opted in via consent |

Full request/response contracts: `docs/LLD.md` (+ delta docs `LLD_v2.md`…
`LLD_v5.md`) §4.

## Running evals

```bash
npm run dev   # separate terminal
curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin1","password":"admin123"}'
curl -s -X POST localhost:3000/eval-runs -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' -d '{}'
```

Or from the frontend (`org_default` only): **Eval report** tab → **Run all
eval cases**. Or as part of the automated suite:
`tests/integration/evalRunner.test.ts` asserts the exact metrics against a
hand-computed expectation.

The eval runner (`src/services/evalRunner.ts`) runs every case through the
**same production `runTriage`/`generateDraft` pipeline** the API uses —
there's no separate scoring-only code path, so a passing eval genuinely
reflects the live system's behavior. See `docs/eval_report.md` for the
current committed numbers and `docs/DEMO_SCRIPT.md` Part 13c for a
narrated walkthrough.

## Architecture, in brief

- **Guardrails, layered** (`docs/HLD.md` §5, `docs/ticket_lifecycle_v5.mermaid`
  for the full annotated flow): L1 input scan (3 pattern detectors — force
  escalation, never block triage) → L2 prompt structure (untrusted content
  always fenced in delimited data blocks) → L3 output scan (6 deterministic
  checks after every draft; most fail-closed — discard the model's draft
  entirely and substitute a code-authored template) → org policy pack (2
  checks, vertical-specific rules from `src/policy_packs/*/guardrail_rules.json`)
  → a conditional semantic judge (1 check, only reached once L3 + org
  policy have both already passed). 13 checks total when every layer runs;
  a separate, 1-check tool-execution-time revalidation guards actual side
  effects at execute time.
- **Guardrails are generic, never ID-based** (ADR-7): nothing anywhere
  blacklists a specific adversarial doc ID. Detection is by content pattern
  (secret-format regexes, n-gram overlap against any non-standard-audience
  doc) and structural rule (citations must be a subset of retrieved doc
  IDs), so an unknown future adversarial document would be caught the same
  way.
- **`requires_human_approval` comes only from `tool_catalog`**, never from
  model output or the client payload (invariant #1) — this is what defeats
  a "don't tell the reviewer" injection even if it reaches the tool-request
  layer.
- **Policy-window math is deterministic and uses only `ticket.created_at`**,
  never `Date.now()`, never the LLM.
- **Idempotency**: `tool_actions.idempotency_key` is a DB-level `UNIQUE`
  constraint; a repeated request returns the stored result (`replayed: true`)
  rather than re-executing, with a race-safe fallback if two requests with
  the same key land concurrently.
- **RAG retrieval, two structurally distinct sources**: KB full-text search
  (citable, drives the citation-subset guardrail check) and pgvector
  similarity search over past ticket resolutions (informational-only
  context, never citable, persisted on the trace as `similar_resolutions`).
  Eval fixtures structurally never reach the embeddings table — the eval
  runner never calls `resolveTicket()`, the function the best-effort
  ingestion hook is attached to.
- **`ModelAdapter`/`EmbeddingAdapter`/`EmailAdapter` interfaces**, each with
  a `mock`/`local`/`hosted` tiered factory — nothing else in the codebase
  imports an AI, embedding, or email HTTP client directly.
- **RBAC** is a single static permission → roles[] table
  (`src/domain/permissions.ts`) read only by `requirePermission()` — an
  auditable, complete list of who can do what, with two routes
  (`/eval-runs/*`, `/embeddings`) additionally hard-gated to `org_default`
  in the handler itself, since eval fixtures and the embedding index only
  meaningfully exist there.

## Known limitations

- **Docker's backend image runs via `tsx` directly against TypeScript
  source**, not the compiled `dist/` output — several modules resolve
  filesystem assets (`data/*.json`, `src/policy_packs/**`) relative to their
  own `__dirname` at runtime, and this app has no cold-start-sensitive
  deployment target that would justify re-plumbing those paths for a
  compiled build. `npm run typecheck`/`build` remain the CI-facing
  type-safety gate (also run as a build-time step inside the Docker image).
- **Retrieval is Postgres full-text search + pgvector similarity**, not a
  dedicated hybrid-search or reranking layer — sufficient for this dataset's
  scale; `RetrievalService` is an interface seam so this can be swapped
  later without touching callers (ADR-2).
- **Eval runner always executes synchronously.** With only a handful of
  seed eval cases, an async/202-and-poll mode above some case-count
  threshold would go unused, so it wasn't built. `GET /eval-runs/:id` still
  works for re-fetching a completed run.
- **Citation coverage is 75%, not 100%, in the default eval report** — by
  design, not a defect. See `docs/eval_report.md` for the full explanation:
  the adversarial cases' mock drafts genuinely attempt the attack, and the
  guardrail fail-closing them costs their citation but proves the defense.
- **No customer *account* system** — the customer portal's manual-verify
  and magic-link paths both mint a scoped, `Role`-less `CustomerToken`;
  there is still no customer password, no customer self-service account
  management, and no customer access to any other customer's data.
- **Frontend has no automated test suite** — verified throughout
  development via `tsc -b`/`vite build` (clean at every milestone) and
  manual browser QA against the full demo flow, including at mobile
  viewport widths; this is a deliberate, standing exemption documented in
  `docs/PROGRESS.md`, not an oversight.

## Repository structure

```
Solution/
  docs/                    HLD/LLD v1-v5, ticket_lifecycle_v1-v5.mermaid,
                           embedding_lifecycle.mermaid, DEMO_SCRIPT.md,
                           eval_report.md, PROGRESS.md
  data/                    seed data (customers, orders, tickets, tool
                           catalog, KB docs) — copied from the requirements
                           repo, never referenced outside this directory
  src/
    api/                   routers (tickets, drafts, tool-actions, orgs,
                           customers, platform, embeddings, customer-auth,
                           signup, users, documents, agent-runs, eval-runs,
                           metrics, dashboard), middleware (auth, tenancy,
                           permissions, rate limiting, errors)
    services/               triage, draft, retrieval, eligibility,
                           evalRunner, guardrails/ (input/output/org-policy
                           scans, semantic judge), prompts/, events/
    adapters/               ModelAdapter/EmbeddingAdapter/EmailAdapter
                           interfaces + mock/local/hosted implementations
                           and their createXAdapter() tier resolvers
    policy_packs/           per-vertical (retail_ecommerce, software,
                           finance) guardrail_rules.json + policy markdown
    db/                     migrations, repos, seed loader
    domain/                 zod schemas + inferred TS types (single source
                           of truth), permissions.ts (RBAC policy table)
    ws/                     customer-chat WebSocket server
  frontend/                 Vite + React + Tailwind SPA — queue, ticket
                           view, action panel, audit trail, embeddings
                           index, eval report, admin, dashboard, customer
                           portal (verify/magic-link/chat); mobile-responsive
  tests/                     unit, integration, e2e (MockModelAdapter/
                           MockEmbeddingAdapter/MockEmailAdapter throughout
                           — no test ever reaches a live provider)
  Dockerfile                 backend image (tsx against TS source, Node 22)
  docker-entrypoint.sh       migrate → seed-if-empty → start
  docker-compose.yml         postgres (pgvector) + backend + frontend
  frontend/Dockerfile         multi-stage: vite build, then nginx (reverse-
                           proxies API paths to the backend container)
```
