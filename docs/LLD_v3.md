# TrustDesk — LLD v3

**Version:** 3.0 · **Extends:** `LLD_v2.md` · **Parent:** `HLD_v3.md` · TDD methodology (LLD v1 §1) applies unchanged to every v3 milestone.

Delta document: only new/changed contracts appear here.

---

## 1. Schema Changes

One additive migration — every new column has a historically-correct
default for all existing v1/v2 rows, so (unlike v2's `org_id` backfill) no
nullable→backfill→NOT NULL dance is needed:

```sql
-- W8: platform-support consent, independently toggleable per sensitivity tier
ALTER TABLE orgs ADD COLUMN allow_platform_support boolean NOT NULL DEFAULT false;
ALTER TABLE orgs ADD COLUMN allow_platform_metrics boolean NOT NULL DEFAULT false;

-- W9: first-login welcome banner, per user
ALTER TABLE users ADD COLUMN welcome_seen_at timestamptz;

-- W7: human takeover
ALTER TABLE tickets ADD COLUMN human_owned boolean NOT NULL DEFAULT false;
ALTER TABLE tickets ADD COLUMN human_owned_by text REFERENCES users;
ALTER TABLE tickets ADD COLUMN human_owned_at timestamptz;

CREATE INDEX ON orgs (allow_platform_support) WHERE allow_platform_support;
```

No new tables. `ticket_messages` needs no schema change — the automatic
greeting is just another row with `author = 'system'` (a new sentinel value
alongside the existing `'customer'` / `user_id` values; `author` was always
free-text, not FK-constrained, so this is not a breaking change).

---

## 2. W6 — Self-Serve Org Signup

**`POST /signup`** (public — mounted in `src/app.ts` before `authMiddleware`,
same tier as `/auth`; rate-limited via `express-rate-limit`, 10 req/hour/IP,
the one unauthenticated write route in the app):

Request: identical shape to `CreateOrgRequest` (`{ name, vertical,
admin_username, admin_password, admin_display_name }`) — the same zod schema
the existing admin-only `POST /orgs` already validates against.

Behavior: calls `orgOnboarding.createOrg()` verbatim (org row, slug
derivation, policy-pack stamping, first admin user — unchanged from v2),
then the new `seedDemoCustomers(orgId)` (4 canned `customers` rows: varied
tier/country/verified, via the existing `insertCustomer()` repo function in
a loop — no new repo code). On success, signs a JWT via the existing
`signToken()` and responds 201 with `{ token, user, org }` — the same shape
`POST /auth/login` returns — so the signer lands directly in the
authenticated app with no separate login round-trip. `409 USERNAME_TAKEN` on
the existing `username_taken` outcome, unchanged.

`seedDemoCustomers()` is also called from the existing admin-only `POST
/orgs` handler, so admin-onboarded orgs get the same starter data as
self-signed-up ones — one code path, two callers.

---

## 3. W7 — Human Takeover & Auto-Resolution

**Automatic greeting** — `POST /tickets` (changed): immediately after
inserting the customer's first inbound message, insert one more
`ticket_messages` row: `direction: "outbound", author: "system", body:
greetingTemplate(org.vertical)`. `greetingTemplate()` (new,
`src/services/ticketGreeting.ts`) is a pure function returning one of three
static strings — no model call, no status transition (a greeting isn't a
real reply, `canTransition()` is not invoked for it).

**Auto-pipeline** — `POST /tickets` (changed): after the greeting, calls
`runTriage()` then re-fetches the ticket (to pick up the persisted `triage`
field, same as the existing two-step manual flow) and calls
`generateDraft()` — the exact same functions the manual `/triage` and
`/draft-reply` routes call, just invoked programmatically. This stays
**synchronous** within the `POST /tickets` response, consistent with HLD
invariant #6 ("every AI run writes its `agent_runs` row synchronously...
before the API responds") — no new async/background-job mechanism is
introduced anywhere in this codebase. The response body gains an optional
`pipeline` object reporting what happened (`{ triage, draft, auto_sent:
boolean }`) so the frontend can render the outcome without extra round-trips;
absent/null fields mean that stage didn't run or was skipped (e.g. no
`customer_id`/vertical resolution failure — treated as best-effort, a
pipeline failure never fails ticket creation itself, since the ticket row
and greeting are already committed by that point).

**`evaluateAutoSend(outcome: DraftOutcome): boolean`** (new pure function,
`src/services/draft.ts`):

```ts
function evaluateAutoSend(outcome: DraftOutcome): boolean {
  return (
    outcome.resolutionType === "answered" &&
    outcome.recommendedActions.every((a) => !a.requires_human_approval)
  );
}
```

Called after **any** successful `generateDraft()` call — both the new
auto-pipeline above and the existing manual `POST /tickets/:id/draft-reply`
route — so behavior is identical regardless of trigger. When eligible, the
route calls the existing `sendDraft()` (unchanged) immediately; the
draft/ticket end up in exactly the state they would if a human had clicked
"send" themselves. `escalated`/`refused_by_policy` resolutions and anything
recommending an approval-gated action are left exactly as today — a pending
draft, visible for a human to review and send. Recommended tool actions are
never auto-requested or auto-executed by this logic; they remain a fully
separate, always-manual request → approve → execute lifecycle (HLD
invariant #1 unchanged).

**Human takeover** — **`POST /tickets/:id/messages/reply`** (new,
`tickets:reply_manual` permission, agent+): body `{ body: string }`. New
`sendManualReply(ctx, ticket, body, authorUserId)` in `ticketThread.ts`,
sibling to `sendDraft()`: same `canTransition(ticket.status,
"awaiting_customer")` check → 409 `illegal_transition` on failure; on
success, inserts an outbound message (`draft_id: null`, `author:
authorUserId`), transitions the ticket to `awaiting_customer`, and — only
if not already set — stamps `human_owned = true, human_owned_by =
authorUserId, human_owned_at = now()` via new `markHumanOwned()` in
`ticketsRepo.ts` (idempotent no-op on a second manual reply to an
already-human-owned ticket).

**Draft-reply blocked once human-owned** — `POST /tickets/:id/draft-reply`
(changed): one added check after the existing "must be triaged" 409 —
`if (ticket.human_owned) return sendError(res, "CONFLICT", "Ticket is
human-owned; AI drafting is disabled for this ticket")`. One-way: there is
no route or flag to un-set `human_owned`. `tool_actions:request` and
`tool_actions:approve` are untouched — a human agent on a human-owned
ticket can still request/approve/execute a catalog action; only AI drafting
of the reply text is blocked.

---

## 4. W8 — Platform Support Visibility

**`GET /orgs/consent`** / **`PUT /orgs/consent`** (`orgs:consent:manage`,
admin, the caller's own org only): new `src/api/routes/orgConsent.ts`. `PUT`
body `{ allow_platform_support?: boolean, allow_platform_metrics?: boolean
}` — both optional, independently settable. New `getConsent(ctx)` /
`updateConsent(ctx, patch)` in `orgsRepo.ts`, scoped by `ctx.org_id` (this
is a normal `OrgContext`-scoped write, unlike the cross-org reads below).

**`GET /platform/tickets?target_org_id=`**, **`GET
/platform/tickets/:id/messages?target_org_id=`** (`platform:tickets:view` +
`org_id === "org_default"` route-level guard, same pattern `POST /orgs`
already established for deliberately crossing the tenancy boundary): new
`src/api/routes/platform.ts`, mounted `app.use("/platform", authMiddleware,
tenancyMiddleware, platformRouter)`. Checks
`getOrgById(target_org_id)?.allow_platform_support === true` → 403
otherwise, then calls the existing `listTickets` / message-listing repo
functions with a **constructed** `{ org_id: target_org_id }` context — not
`req.orgContext` — the one place in this router family that intentionally
does so. Read-only: no triage/draft/reply/tool-action routes exist under
`/platform`.

**`GET /platform/metrics?target_org_id=`** (`platform:metrics:view` + same
org_default guard): same pattern, gated on `allow_platform_metrics`, reuses
`computeQualityMetrics()` unchanged with a constructed context.

Both flags are org-wide booleans (not per-ticket/per-agent allow-lists) —
granting `allow_platform_support` means every ticket in that org becomes
visible to every `org_default` agent with the permission, matching the
simplicity of a single in-app toggle.

---

## 5. W9 — Dashboard Home

**`GET /dashboard/summary`** (`dashboard:view`, agent+): new
`src/services/dashboardSummary.ts`, new route `src/api/routes/dashboard.ts`.
Response:

```json
{
  "tickets_by_status": { "open": 3, "in_progress": 1, "awaiting_customer": 2, "...": "..." },
  "quality": { "draft_acceptance_rate": 0.9, "action_approval_rate": 1.0, "avg_rating": 4.2, "guardrail_block_rate": 0.05 },
  "eval_summary": { "available": true, "eval_run_id": "...", "completed_at": "...", "metrics": { "...": "..." } }
}
```

`tickets_by_status` from a new `countTicketsByStatus(ctx)` in
`ticketsRepo.ts` (`GROUP BY status`, scoped by `ctx.org_id`). `quality`
reuses `computeQualityMetrics()` unchanged. `eval_summary.available` is
`false` (with no other fields) for every org except `org_default`, since
the eval runner remains hardcoded to `org_default` (v2's `EVAL_ORG`,
unchanged in v3 — genuinely out of scope) — this is a known, carried-forward
limitation surfaced explicitly rather than hidden.

**`POST /users/me/welcome-seen`** (authenticated, no extra permission
beyond being logged in): new `markWelcomeSeen(ctx, userId)` in
`usersRepo.ts` (`UPDATE users SET welcome_seen_at = now() WHERE
user_id=$1`). `POST /auth/login` and `POST /signup` responses both gain
`welcome_seen_at` on the `user` object so the frontend knows whether to show
the banner without an extra call.

---

## 6. W10 — Frontend

- **Tailwind CSS**: `tailwindcss`/`postcss`/`autoprefixer` added to
  `frontend/`; `tailwind.config.js` theme extension mirrors the current
  `design-system/tokens.css` custom properties (neutral surface palette,
  status colors). Existing `Shell.tsx`/`DataTable.tsx`/`StatusBadge.tsx`
  rebuilt on utility classes; every new component below is Tailwind-first.
- **`react-router-dom`**: `/` (Landing), `/signup` (Signup), `/login`
  (existing `Login.tsx`) as public routes; `/app/*` as the authenticated
  tree, internally still using the existing `View`-union `useState`
  switching inside `App.tsx` (unchanged — only the top-level split between
  public and authenticated trees is new).
- **`recharts`**: dashboard's ticket-status pie chart and any trend charts.
- **New `design-system/` components**: `MetricTile.tsx` (stat card),
  `Chart.tsx` (thin recharts wrapper, token-colored), `Modal.tsx` (consent
  toggle confirmation), `WelcomeBanner.tsx` (dismissible, calls
  `POST /users/me/welcome-seen`), `ChatThread.tsx` (bubble-styled thread —
  replaces `TicketView`'s `<ul class="thread-list">` — left/right aligned
  by direction, distinct styling for `author:"system"` greeting rows, a
  compose box wired to `POST /tickets/:id/messages/reply`, disabled once
  `ticket.human_owned` with an explanatory label, and an "auto-sent" badge
  on messages the backend sent without a human clicking anything).
- **New `useTypewriter(text: string)` hook**: client-side-only incremental
  reveal of already-final (post-L3) text — the "live generation" feel
  without any backend streaming (HLD v3 ADR-18). Used wherever a draft or
  reply body renders.
- **New pages**: `pages/Landing.tsx` (product description, CTA to signup),
  `pages/Signup.tsx` (reuses `Admin.tsx`'s existing org-onboarding
  form-field shapes/validation, posts to `POST /signup`, auto-navigates into
  the app on success), `pages/Dashboard.tsx` (`WelcomeBanner` if
  `!welcome_seen_at`, `MetricTile`s + `Chart` from `/dashboard/summary`).
- **Changed**: `TicketView.tsx` (swap to `ChatThread`, human-owned/auto-sent
  badges), `Admin.tsx` (new consent-toggle section calling
  `GET/PUT /orgs/consent`), `App.tsx` (router wrapper, new `dashboard` and
  `platform` nav entries), `api.ts` (types + methods for every route in
  §2-5 above).
- **New**: `components/PlatformSupport.tsx` — `org_default`-only nav item, a
  read-only ticket/metrics browser across consenting orgs via `/platform/*`.
- A visual pass migrates every existing page (Queue, Documents,
  QualityDashboard, EvalReport, Admin) onto Tailwind utility classes for
  consistency with the new pages.

---

## 7. V3 Milestones (TDD, each green before the next)

| # | Milestone | Tests written first |
|---|---|---|
| V3-1 | `HLD_v3.md`/`LLD_v3.md`/`ticket_lifecycle_v3.mermaid` + `CLAUDE.md` invariant #8 amendment | n/a — docs milestone |
| V3-2 | Migration (consent flags, `human_owned`, `welcome_seen_at`) + `seedDemoCustomers()` wired into both `createOrg()` callers | migration up/down; new org has N customers; existing v1/v2 rows unaffected by new-column defaults |
| V3-3 | Public `POST /signup` + auto-login + rate limit | unauthenticated 201 creates org+admin+customers, returns a usable token; `username_taken` 409; existing admin-gated `POST /orgs` unchanged; rate limit trips past the threshold |
| V3-4 | Automatic greeting + `POST /tickets/:id/messages/reply` + `human_owned` flag + draft-reply 409 block | greeting row present with correct author/vertical text; manual reply transitions status + sets `human_owned`; draft-reply 409s post-takeover; tool-action routes remain unaffected on human-owned tickets |
| V3-5 | `evaluateAutoSend()` wired into the new ticket-creation auto-pipeline and the existing manual draft-reply route | answered+no-gated-action auto-sends (draft.status→sent, ticket.status→awaiting_customer) identically from both trigger paths; escalated/refused_by_policy/gated-action cases stay pending; `POST /tickets` response reports final pipeline state synchronously |
| V3-6 | `GET/PUT /orgs/consent` + `/platform/tickets` + `/platform/metrics`, org_default-gated | non-admin 403 on consent; non-org_default caller 403 on platform routes; consent=false → 403 even for org_default; existing two-org isolation suite (LLD_v2 §6) still green |
| V3-7 | `GET /dashboard/summary` + `POST /users/me/welcome-seen` | ticket-count-by-status math on fixtures; quality metrics reused correctly; `eval_summary.available=false` for non-org_default; welcome-seen set-once semantics |
| V3-8 | Frontend foundation: Tailwind setup, new design-system components, Landing + Signup pages, router | manual browser QA (no frontend test runner exists in this repo) |
| V3-9 | Frontend integration: Dashboard, `ChatThread` in `TicketView`, consent-toggle UI, `PlatformSupport` view, Tailwind migration pass across existing pages | manual browser QA |
| V3-10 | Docs/regression: `docs/PROGRESS.md` V3 notes, full v1+v2+v3 suite green, `npm run smoke:local` re-verified against the new auto-resolution behavior | full backend suite run |

**Standing regression rule (unchanged since v1):** the full v1+v2 suite,
including eval_005/006/007 adversarial tests, runs green at the end of
every v3 milestone.
