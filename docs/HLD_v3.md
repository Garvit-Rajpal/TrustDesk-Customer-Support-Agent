# TrustDesk — HLD v3 (Product Extension)

**Version:** 3.0 · **Extends:** `HLD_v2.md` (v1/v2 remain valid; this document only adds and amends) · **Status:** Agreed baseline for LLD v3

V2 turned TrustDesk into a multi-tenant support product with RBAC, threaded
tickets, feedback, and a minimal frontend. V3 turns it into something a
prospective customer can actually discover, sign up for, and run with
minimal human effort: self-serve tenant onboarding, a modernized UI, tickets
that resolve themselves end-to-end when the AI is confident, a real
chat-style thread with a clean human-takeover boundary, and optional
platform-level support visibility across tenants.

**V3 workstreams and build order:**

| # | Workstream | Depends on |
|---|---|---|
| W6 | Self-serve org signup + demo customer seeding | W5 (org onboarding, `createOrg()`) |
| W7 | Human takeover + auto-resolution | W4 (threads, status machine), W5 (org context) |
| W8 | Platform support visibility (cross-org, consent-gated) | W5 (multi-tenancy) |
| W9 | Dashboard home (metrics summary + first-login welcome) | W3 (feedback/quality metrics) |
| W10 | UI revamp: Tailwind, router, landing page, chat thread | W1 (design system foundation) |

**Compatibility guarantee:** every v1/v2 test stays green throughout. New DB
columns are additive with safe defaults (no backfill migrations needed, per
LLD v3 §1). No existing route's request/response shape changes except the
two explicitly amended in ADR-15 (`POST /tickets`, `POST /tickets/:id/draft-reply`),
and both changes are additive (new optional response fields / one new 409
case), not breaking.

---

## New ADRs

### ADR-14: Self-serve org signup (W6)

v1/v2 invariant #8 ("No customer auth exists. No signup endpoint.") is
**superseded, narrowly**: TrustDesk now has a public, unauthenticated `POST
/signup` for a prospective *tenant* to create their own organization and
first admin account, picking their own vertical, username, and password.
This is org-admin self-service, not end-customer (ticket-submitter) signup —
the `customers` domain concept (a tenant's own end-users, who submit
tickets) still has zero authentication of any kind; that boundary is
untouched. `POST /signup` reuses `orgOnboarding.createOrg()` verbatim (the
same service the admin-only `POST /orgs` has called since v2) and
additionally seeds each new org with a handful of demo `customers` rows, so
a tenant can create test tickets against their own stamped policy pack
immediately, without a separate `POST /customers` call first. Being
unauthenticated and write-capable, it is the one route in the app with a
request-rate limit (LLD v3 §2).

### ADR-15: Human takeover and auto-resolution (W7)

Two complementary behavioral changes to the ticket pipeline, both
extensions of "the model proposes, deterministic code disposes" (HLD v1
invariant #1) rather than departures from it:

- **Auto-resolution.** `POST /tickets` now runs the triage → draft pipeline
  synchronously at creation time (reusing `runTriage()`/`generateDraft()`
  unchanged), and any successful draft — auto-triggered or manually
  triggered by an agent — is evaluated by a new deterministic function,
  `evaluateAutoSend()`: if `resolution_type === "answered"` and no
  recommended tool action requires approval, the reply is sent immediately,
  no human click required. Anything `escalated`, `refused_by_policy`, or
  paired with an approval-gated action always waits for a human — the
  auto-send *decision itself* is deterministic code, never model output,
  same as every other disposal decision in this system. Recommended tool
  actions are unaffected by auto-send either way: they always still go
  through the unchanged request → approve → execute lifecycle.
- **Human takeover.** A new capability lets an agent send a manually-typed
  reply (`POST /tickets/:id/messages/reply`) that bypasses the draft
  pipeline entirely. The first time this happens on a ticket, it becomes
  `human_owned` — permanently, until resolved/closed. From that point,
  `POST /tickets/:id/draft-reply` 409s for that ticket: once a human has
  taken direct control of a conversation, the AI does not re-enter it. Tool
  actions remain requestable on human-owned tickets (a human agent may still
  need to invoke a catalog action); only AI *drafting* is blocked.
- **Known, carried-forward limitation:** L1 guardrail scanning has always
  been pipeline-triggered (it runs when triage/draft next process an
  inbound message), not insert-triggered — `simulateInbound()` itself never
  scans. This was already true in v2. Human-takeover makes it durable for
  that thread, since draft-reply (the thing that would trigger L1) is now
  permanently blocked there. Decoupling L1 into an always-on inbound scan
  independent of the drafting pipeline is deferred — flagged, not silently
  fixed or silently ignored.

### ADR-16: Platform support visibility, consent-gated (W8)

`org_default` (the platform operator) may view a tenant's tickets/threads
and/or their feedback/quality metrics, but **only** if that tenant's own
admin has explicitly opted in — two independent boolean flags on `orgs`
(`allow_platform_support` for ticket content, `allow_platform_metrics` for
aggregated quality data), since raw customer conversation content and
anonymized quality numbers are different sensitivity tiers and a tenant
should be able to grant one without the other. Access is **read-only**: no
triage, draft, reply, or tool-action capability on a tenant's behalf, ever —
this is oversight/support-quality tooling for the platform operator, not a
delegated-agent model. It surfaces in a dedicated "Platform Support" view,
never merged into `org_default`'s own ticket queue, so an `org_default`
agent can never confuse "my org's ticket" with "a tenant's ticket I'm
allowed to look at." Enforcement follows the same precedent v2's `POST
/orgs` already established for crossing the tenancy boundary deliberately:
role permission (`platform:tickets:view`/`platform:metrics:view`) plus an
explicit `org_id === "org_default"` check in the route handler, plus the
target org's consent flag — three independent gates, not one.

### ADR-17: Dashboard home (W9)

Every authenticated user now lands on a dashboard rather than straight into
the ticket queue: ticket counts by status, reused `computeQualityMetrics()`
output (feedback/approval/guardrail rates), and — where available — a
summary of the org's latest eval report. Eval reports remain `org_default`-
only (v2's `EVAL_ORG` hardcoding is unchanged; genuinely out of v3's scope
to generalize per-org eval cases), so every other org's dashboard shows an
explicit "not configured for your organization" state for that one card
rather than an empty or broken one. A **first-login welcome banner** (new
`users.welcome_seen_at` timestamp, set once, never reappearing for that
user) greets a freshly onboarded admin with getting-started guidance —
distinct from the always-present metrics below it.

### ADR-18: UI revamp — Tailwind, routing, chat thread, perceived streaming (W10)

- **Tailwind CSS** replaces the plain hand-rolled CSS approach v2 actually
  shipped with (v2's HLD said "Tailwind + headless primitives" but the real
  build stayed CSS-only — v3 corrects that divergence). Design tokens
  (neutral surface palette, status colors) become a Tailwind theme
  extension instead of raw CSS custom properties; component-specific
  styling that doesn't fit utility classes cleanly stays as small scoped
  CSS, not fought into Tailwind.
- **`react-router-dom`** is added because v3 introduces a genuinely public
  route tree (landing page, signup) alongside the authenticated app — the
  v1/v2 approach of one `useState`-driven view switch inside an
  always-logged-in-or-always-logged-out root can't represent that
  distinction or support deep links/back-button across it. The
  authenticated app's *internal* view switching is untouched.
- **Chat-style `ThreadView`** replaces the v2 plain `<ul>` message list —
  bubble-aligned by direction, a distinct style for the new automatic
  greeting message (`author: "system"`), a compose box for human-takeover
  replies, and a badge distinguishing "sent by a human" from "auto-sent by
  the pipeline."
- **Perceived streaming, not real streaming.** The triage/draft pipeline
  still runs atomically end-to-end exactly as in v1/v2 (retrieve → draft →
  L3 guardrail scan, all-or-nothing) — this was a deliberate choice over
  true token-level model streaming, specifically to preserve the "never
  expose content that L3 later rejects" property of ADR-7/invariant #5.
  True streaming would mean an agent watches unsafe text materialize in
  real time before a fail-closed substitution swaps it out; a client-side
  typewriter reveal of the already-guardrail-passed final text gets the
  same "it's alive" feel with zero exposure risk and zero backend/adapter
  changes.

---

## Amended sections

- **§3 Components:** add `SignupService` (thin wrapper reusing
  `OrgService.createOrg()` + `seedDemoCustomers()`), `PlatformSupportService`
  (read-only cross-org query layer, constructs `OrgContext` from a
  `target_org_id` rather than `req.orgContext`), `DashboardService`
  (aggregates ticket counts + quality metrics + eval summary).
  `TicketService`/`DraftService` gain the auto-pipeline/auto-send/
  human-takeover logic described in ADR-15.
- **§5 Guardrails:** unchanged in design and scope; the known
  pipeline-triggered-only limitation is explicitly documented (ADR-15)
  rather than silently expanded or fixed.
- **§8 Roadmap:** real channel ingestion (email/portal adapter) and
  per-org eval cases remain deferred (still not v3). New v4+ candidates
  surfaced by this round: decoupled always-on L1 inbound scanning
  independent of the draft pipeline; per-ticket/per-agent granularity for
  platform-support consent (today it's org-wide); a "return to AI" escape
  hatch for human-owned tickets if operators find the one-way rule too
  rigid in practice.

## V3 traceability (capstone rubric)

W6/W10 (self-serve onboarding + UI polish) directly address "a real
product a stranger could sign up for and use," which v1/v2 explicitly
deferred ("polish not graded" was a v1/v2-era simplification, not a
permanent constraint). W7 (auto-resolution) demonstrates the "model
proposes, deterministic code disposes" pattern extended to a genuinely
autonomous end-to-end path, not just individual pipeline stages. W8
strengthens the multi-tenancy stretch goal from v2 with a consent-respecting
cross-tenant oversight capability. W9 closes the loop v2's quality-metrics
work opened but never gave a home page to.
