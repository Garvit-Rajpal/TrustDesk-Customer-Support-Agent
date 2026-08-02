# TrustDesk — LLD v5

**Version:** 5.0 · **Extends:** `LLD_v4.md` · **Parent:** `HLD_v5.md` · TDD methodology (LLD v1 §1) applies unchanged to every v5 milestone with tests; pure frontend-visual milestones are manual-QA-only, the established v1-v4 convention (no frontend test runner exists — `frontend/package.json` has no test script).

Delta document: only new/changed contracts appear here.

---

## 1. Schema Changes

The only DB change in this plan — one new table, no `ALTER`s to existing
tables, no new columns on `customers` (it already has `email` — see
`getCustomerByEmail()` in `customersRepo.ts`).

```sql
-- W25: magic-link opaque tokens. mlk_ prefix, new in ids.ts. The raw token
-- is never stored — only its sha256 hash, so a DB read alone can never
-- reveal a usable token (mirrors why passwords are hashed, though this
-- uses crypto.createHash("sha256"), not bcrypt — see note below).
CREATE TABLE customer_magic_links (
  link_id       text PRIMARY KEY,
  org_id        text NOT NULL REFERENCES orgs,
  customer_id   text NOT NULL REFERENCES customers,
  ticket_id     text REFERENCES tickets,       -- optional: scope to one ticket
  token_hash    text NOT NULL,
  expires_at    timestamptz NOT NULL,           -- created_at + 15 min
  consumed_at   timestamptz,                    -- single-use marker, NULL until consumed
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON customer_magic_links (token_hash);
CREATE INDEX ON customer_magic_links (customer_id, created_at);
```

**Why `crypto.createHash("sha256")`, not `bcrypt`.** Every other secret
this app hashes is a low-entropy human-chosen password, where `bcrypt`'s
deliberate slowness defends against offline brute-force guessing. A
magic-link token is `crypto.randomBytes(32)` — 256 bits of generator
entropy, not a guessable human choice — so a fast cryptographic hash is the
correct primitive; `bcrypt`'s slowness would add cost with no corresponding
security benefit here. This is the first place in the codebase that hashes
a high-entropy opaque token rather than a password; the distinction is
worth a code comment at the call site so a future reader doesn't "fix" it
into `bcrypt` for consistency.

The two-index shape supports the two access patterns W25 needs: an exact
lookup by `token_hash` at consume time (`UNIQUE INDEX`), and a
`customer_id`-scoped recency query for the per-customer anti-abuse guard
(`countRecentLinksForCustomer()`, §5 below).

No schema change anywhere else in v5 — W21-W24 and the visual half of W26
are frontend-only; `POST /customer-auth/verify`'s existing behavior and the
`CustomerTokenClaims` shape itself are unchanged (a longer `expiresIn` is a
JWT-signing parameter, not a schema or claims-shape change).

---

## 2. W21 — Shared Visual/Animation Primitives

**`frontend/src/design-system/GradientBlobBackground.tsx`** (new): props
`{ variant?: "landing" | "auth" | "portal"; blobCount?: number }`. Extracted
verbatim from the markup currently duplicated in `Landing.tsx`/`Login.tsx`/
`Signup.tsx` — each of those three pages' existing blob div block is
replaced with `<GradientBlobBackground variant="..." />`, required to
render pixel-identical output to today (regression-checked, not a visual
change, in this workstream's own milestone).

**`frontend/src/design-system/Carousel.tsx`** (new): generic,
children-based. Props: `{ children: ReactNode[]; autoAdvanceMs?: number;
pauseOnHover?: boolean }`. Implementation: a `translateX` track on an
internal `useInterval`-style hook (plain `setInterval`, cleaned up on
unmount — same primitive-JS shape `useTypewriter.ts` already uses, no new
dependency), dot navigation (click to jump to a slide), pauses on
`mouseenter`, resumes on `mouseleave`, and responds to `ArrowLeft`/
`ArrowRight` when focused (keyboard accessibility — the first place in this
app's frontend that needs explicit keyboard-nav handling beyond native
form/button semantics).

**`frontend/src/design-system/Footer.tsx`** (new): presentational only, no
props beyond optional className passthrough — column content is hardcoded
(product/company/legal placeholder links + copyright), consumes
`tokens.css` design tokens for color/spacing, no state, no API calls.

**`frontend/tailwind.config.js`** (changed): any keyframe `Carousel`'s
implementation needs beyond plain CSS `transform: translateX(...)`
transitions (likely none — a `transition-transform` utility class may be
sufficient without a new `@keyframes` block; confirmed/adjusted during
implementation). `scale-in` (already present since v4's W18, unused since)
gets its first real consumers starting in W22 — no change needed to the
keyframe definition itself.

---

## 3. W22 — Animated Landing-Page Chat Demo

**`frontend/src/design-system/ChatDemo.tsx`** (new): a hardcoded script,
`const SCRIPT: {author: "customer" | "agent"; text: string; delayMs:
number}[]`, rendered as a small static conversation. Each `agent` line's
text reveals via the existing `useTypewriter` hook (same
`{display, done}` return shape `ChatThread.tsx`'s `Bubble` already
consumes); each bubble's mount uses `scale-in` for the message
container plus `fade-in-up` for the surrounding stagger, matching the
pattern `Landing.tsx`'s existing hero entrance already establishes. After
the last line's `done` fires, a pause, then the script restarts from the
top (looping demo, no user interaction required or expected). Renders an
explicit "Example conversation" label above the bubble stack.

**`Landing.tsx`** (changed): mounts `<ChatDemo />` in the hero area,
adjacent to the existing headline/CTA — layout only, no change to the
hero's existing gradient/blob background (now `GradientBlobBackground`
from W21).

**Milestone:** manual browser QA only (no frontend test runner — the
established convention).

---

## 4. W23 — Testimonials Carousel + Footer

**`frontend/src/design-system/TestimonialCard.tsx`** (new): props
`{ name: string; role: string; quote: string; initial: string }` (an
`initial`-letter avatar rather than an image asset — no image-hosting
concern for placeholder content). Fictional/placeholder copy, sourced from
a small hardcoded array alongside the component or in a sibling
`testimonials.ts` data file — explicitly not from any DB table (per
`HLD_v5.md` ADR-26, this is marketing copy, not user-generated content).

**`Landing.tsx`** (changed): mounts `<Carousel>{testimonials.map(t =>
<TestimonialCard key={t.name} {...t} />)}</Carousel>` below the existing
feature-card grid, and `<Footer />` at the page bottom.

**Milestone:** manual browser QA only, including explicit checks of
autoplay, pause-on-hover, dot-navigation click targets, and keyboard
arrow-key navigation (the accessibility surface W21's `Carousel` added).

---

## 5. W24 — Login/Signup/Dashboard Deep Visual Redesign

**`Login.tsx`/`Signup.tsx`** (changed): replace each page's now-inlined
blob markup with `<GradientBlobBackground variant="auth" />` (W21); wrap
each form-field group and any error-message block in a `scale-in`-animated
container (first real consumer of the keyframe W18 staged); layout/copy
refresh within the existing form structure — no change to either page's
submission logic, validation, or API calls (`api.login`/`api.signup`
untouched).

**`Dashboard.tsx`/`MetricTile.tsx`** (changed): `scale-in` applied to each
KPI tile's mount (staggered by index, same pattern `ChatDemo.tsx`'s bubble
stagger uses); general layout/spacing pass. The `dataviz` skill is
re-invoked only if chart palette or layout materially changes during this
pass — not assumed necessary up front, since W18 already did the
chart-specific restyle.

**Milestone:** manual browser QA across all three pages, plus `npm run
typecheck`/`npm run build` clean (this frontend's closest analogue to a
green test gate).

**Known issue, noted not fixed.** During this pass's manual QA, the
Dashboard's "Tickets by status" pie chart was observed rendering no
visible slices. `git diff` confirms this workstream's changes never touch
that chart's JSX/data path — the issue predates W24 and is out of scope
for a purely animation/spacing-focused redesign; left as a known,
pre-existing bug for a future pass rather than silently worked around.

---

## 6. W25 — Magic-Link Auth Backend

**`src/adapters/emailAdapter.ts`** (new interface, mirrors
`embeddingAdapter.ts`'s shape):

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}
```

Kept generic (not magic-link-specific) so a future feature can reuse it
without a new interface.

**`src/adapters/mockEmail.ts`** (new): `MockEmailAdapter` — every `send()`
call pushes the message onto a public `sent: EmailMessage[]` array and
resolves immediately, never touching the network. Mandatory in every test
per CLAUDE.md's TDD rule (same rule `MockModelAdapter`/`MockEmbeddingAdapter`
already follow) — a test suite that reaches a real `EmailHttpAdapter` is a
bug in the test, not a feature.

**`src/adapters/emailHttp.ts`** (new): `EmailHttpAdapter` — plain `fetch`,
no SDK (mirrors `EmbeddingHttpAdapter`'s explicit "not an SDK, same
reasoning as `OpenRouterAdapter`" precedent). One class serves both `local`
and `hosted` tiers via different `baseUrl`/`apiKey` constructor
parameters, `local` defaulting to `http://localhost:8025`.

**As-built deviation: both tiers use a Resend-shaped payload, not a
Mailpit-shaped one.** Mailpit is fundamentally an SMTP catcher with its own
inspection UI, not an HTTP send API — there is no "Mailpit request shape"
for a plain-`fetch` adapter to target the way there is for a real
transactional-email HTTP API. Rather than build a second, genuinely
different request shape for local vs. hosted, `EmailHttpAdapter` models
*both* tiers' payload after Resend's real HTTP API (`POST
${baseUrl}/emails`, `Authorization: Bearer ${apiKey}`, body
`{from, to, subject, text, html}`) — `local`'s `baseUrl`/`apiKey` are just
developer-configured to point at whatever local mail-catching HTTP shim a
developer chooses to run (a placeholder key, `"mailpit-local"`, is used by
default since none is required). This is safe precisely because
`MockEmailAdapter` — never `EmailHttpAdapter` — is the only adapter any
test ever reaches (`EMAIL_TIER` is `mock` in every test and throughout this
project's own dev/QA sessions); `EmailHttpAdapter` itself is validated only
against a fully-mocked `fetch` (V5-16). No Mailpit `docker-compose.yml`
service was actually provisioned in this pass — `EMAIL_TIER` never left
`mock` end-to-end, so the plan's "add Mailpit as a new optional
`docker-compose.yml` service" recommendation was not needed to complete
V5-15 through V5-27 and was not acted on.

**`src/adapters/createEmailAdapter.ts`** (new, mirrors
`createEmbeddingAdapter.ts`'s `resolveEmbeddingTier()`/factory pattern
exactly): `resolveEmailTier(env)` reads `EMAIL_TIER=mock|local|hosted`
(falls back to `mock` if unset, same conservative default
`resolveModelTier()`/`resolveEmbeddingTier()` use), infers `hosted` from
`EMAIL_API_KEY` if `EMAIL_TIER` is unset but the key is present. `hosted`
never reuses `OPENAI_API_KEY` or `EMBEDDINGS_API_KEY` — a third, distinct
credential, same "distinct credential" reasoning `EMBEDDINGS_API_KEY`
already established relative to `OPENAI_API_KEY`.

**New env vars** (`.env.example`, mirroring `EMBEDDING_*` naming exactly):
`EMAIL_TIER`, `EMAIL_API_KEY`, `EMAIL_BASE_URL`, `EMAIL_FROM_ADDRESS` (no
analog in the embedding trio — an email needs a From address). Plus one
piece of genuinely new environment surface: `PORTAL_BASE_URL` (e.g.
`http://localhost:5173` in dev), since nothing today gives the backend the
frontend's origin (dev uses a same-origin Vite proxy) — needed to build the
absolute `${PORTAL_BASE_URL}/portal/magic-link?token=...` URL embedded in
the email body.

**`src/db/repos/customerMagicLinksRepo.ts`** (new):
- `insertMagicLink(ctx, row): Promise<void>` — `org_id`, `customer_id`,
  `ticket_id?`, `token_hash`, `expires_at`.
- `findValidMagicLinkByTokenHash(tokenHash): Promise<MagicLinkRow | null>`
  — `WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`;
  excludes both expired and already-consumed rows by construction, so a
  caller never has to separately check either condition.
- `markMagicLinkConsumed(linkId): Promise<boolean>` — `SET consumed_at =
  now() WHERE link_id = $1 AND consumed_at IS NULL`, returning whether the
  `UPDATE` actually affected a row (**as-built deviation**: originally
  specced as `Promise<void>` here; implementation upgrades it to `boolean`
  because a `void` return gives the route handler no way to tell it lost a
  concurrent consume race. The `AND consumed_at IS NULL` guard alone
  correctly stops a *second write* at the DB level, but without the route
  itself checking a boolean result, a losing concurrent request would still
  fall through past the DB call and mint a `CustomerToken` anyway — the
  opposite of the single-use guarantee this whole feature exists to
  provide. The route (`POST /magic-link/consume`, below) treats `false` the
  same as a not-found/expired token: generic 401, no token minted).
- `countRecentLinksForCustomer(customerId, sinceMinutesAgo): Promise<number>`
  — feeds the per-customer anti-abuse guard in `/magic-link/request`.

**`ids.ts`** (changed): `newMagicLinkId = () => \`mlk_${nanoid()}\`` — new
prefix, added to the existing list.

**Routes** (`src/api/routes/customerAuth.ts`, extended):

`POST /customer-auth/magic-link/request` — public, unauthenticated.
Request: `{ org_slug: string; email: string; ticket_id?: string }`.
Rate-limited 5/hour/IP (mirrors `/verify`'s existing limiter) **plus** a
second, per-customer guard: if a real customer match is found and
`countRecentLinksForCustomer(customer_id, 60)` already exceeds a small
threshold (e.g. 3), silently skip sending a new email (still return the
identical generic 200 — the caller never learns a guard tripped, same
non-enumeration posture as everything else on this response). On a real
match: `crypto.randomBytes(32).toString("hex")` raw token,
`crypto.createHash("sha256").update(raw).digest("hex")` stored hash,
`insertMagicLink()` with `expires_at = now() + 15min`, then
`emailAdapter.send()` with a link to
`${PORTAL_BASE_URL}/portal/magic-link?token=${raw}`. Response:
`{ data: { ok: true } }` unconditionally — identical whether or not the
email matched, whether or not the abuse guard tripped, whether or not the
email adapter call itself throws (best-effort send, logged not surfaced,
matching the "never let an internal failure leak information via response
shape" posture — though unlike W15's embedding ingestion, a genuinely
failed send here has a real UX cost, so it is logged loudly server-side
even though the caller-visible response stays generic).

`POST /customer-auth/magic-link/consume` — public, unauthenticated.
Request: `{ token: string }`. Rate-limited 20/hour/IP (token-guessing
against 256 bits of entropy is computationally infeasible, but throttled
for consistency with the rest of this surface). Hashes the supplied token,
calls `findValidMagicLinkByTokenHash()`; not-found (never existed, already
expired, or already consumed — all three collapse to the same lookup
miss) returns a generic `401 UNAUTHENTICATED "Link expired or already
used"` — deliberately more specific than `/verify`'s failure message,
since there is no enumeration risk in telling a token-holder their
*token* is stale (unlike telling an *email* guesser whether that email
exists). On a hit: `markMagicLinkConsumed(link_id)`, then
`signCustomerToken({customer_id, org_id, ticket_id}, { expiresIn: "30d"
})`. Response: `{ data: { customer_token, customer: {customer_id, name},
ticket_id? } }` — same response shape `/verify` already returns, so
frontend session-storage logic can treat both entry paths identically.

**`signCustomerToken()`** (`src/services/tokens.ts`, changed): gains an
optional second parameter, `signCustomerToken(claims: CustomerTokenClaims,
opts?: { expiresIn?: string })`, defaulting to the existing `"1h"` when
omitted — `/verify`'s existing call site is untouched, passes no second
argument, and its behavior is byte-identical to v4. `/magic-link/consume`
is the only call site that passes `{ expiresIn: "30d" }`.

**Explicit contrast test (not an idempotency test).** A dedicated test
consumes a magic-link token once (succeeds), then attempts to consume the
identical token again and asserts the second attempt is **rejected**
(`401`, generic message) — not that it returns the first attempt's cached
result. This is the deliberate opposite of how `idempotency_key` replay
(invariant #7) is tested elsewhere in this suite; the test file's own
comment states this contrast explicitly so a future reader doesn't
"fix" the behavior to match invariant #7's pattern by mistake.

---

## 7. W26 — `/portal/*` Visual Pass + Magic-Link Portal UI Integration

**`PortalVerify.tsx`/`PortalChat.tsx`** (changed): adopt
`<GradientBlobBackground variant="portal" />` (W21) in place of today's
flat `bg-ds-bg` shell; `scale-in`/`fade-in-up` on form/message-list
mounts. Purely presentational — no change to either page's existing
data-fetching or WS-connection logic.

**`PortalVerify.tsx`** (changed, functional): a toggle between the
existing manual-verify form and a new "email me a link instead" form
(org-slug + email + optional ticket ID — **as-built note:** no order-ID
field on this form, since `MagicLinkRequest` (`src/domain/authTypes.ts`,
W25) only ever accepted `ticket_id?`, never `order_id`, on the backend; the
manual-verify form's exactly-one-of order/ticket toggle has no equivalent
here), the latter posting to a new `api.customerMagicLinkRequest()`. On
submit, shows a generic "If that email matches an account, a link has been
sent" confirmation regardless of outcome (mirrors the backend's own
non-enumeration response — the frontend must not introduce a client-side
tell the backend deliberately avoided).

**`frontend/src/portal/PortalMagicLinkConsume.tsx`** (new): mounted at a
new route, `/portal/magic-link`, in `App.tsx`. On mount: reads `token`
from the URL query string, immediately calls
`api.customerMagicLinkConsume(token)` (auto-consume, per the confirmed
UX decision — no intermediate "Continue" click), shows a loading state
while in flight. Success: stores the returned `customer_token` (same
storage mechanism `PortalVerify.tsx`'s manual-verify success path already
uses) and navigates to `/portal/chat`. Failure: "This link has expired or
was already been used" message with a link back to `/portal/verify` — no
retry-in-place, since a consumed/expired token can never succeed on retry
by design.

**Returning-customer skip** (`PortalVerify.tsx`, changed): on mount,
checks for an already-stored, unexpired `customer_token` (of either kind —
manual-verify or magic-link-derived; the check doesn't need to
distinguish, since both produce the identical `CustomerTokenClaims`
shape); if present, skips straight to `/portal/chat` without rendering
either verify form. This is what actually delivers the "reusable session"
value a magic link's longer expiry provides — the value shows up on a
*return* visit, not the initial grant.

**`frontend/src/api.ts`** (changed): two new client methods,
`customerMagicLinkRequest(orgSlug, email, ticketId?)` and
`customerMagicLinkConsume(token)`, both thin wrappers over the new backend
routes, following the existing `customerVerify()` method's shape.

**CLAUDE.md invariant #8:** the v5 amendment drafted in W20 is finalized
here against what W25/W26 actually built (see draft text in W20's
milestone / `CLAUDE.md` itself once amended).

**New permanent adversarial test** (joins eval_005/006/007 and v4's
portal-injection test as a standing regression case): a consumed
magic-link token, replayed through the **real** `POST
/customer-auth/magic-link/consume` route end-to-end (not just the repo-
level unit test from W25), is rejected —
`tests/integration/magicLinkReplayRegression.test.ts`, imports the default
`app` export directly (same pattern `portalInjectionRegression.test.ts`
uses), rather than a dedicated `testApp`.

**As-built note on V5-23's manual QA method.** With `EMAIL_TIER=mock`
throughout this project's own dev/QA sessions (no Mailpit instance was
ever provisioned — see §6's `EmailHttpAdapter` note above), the request
→ email → click path was verified in two parts instead of one continuous
Mailpit-UI walkthrough: the request form's UI/confirmation was exercised
live in the browser against the running dev backend, and the auto-consume
→ chat / expired-replay / returning-customer-skip paths were exercised by
seeding a `customer_magic_links` row directly (a raw token + its hash,
via a one-off script using the real `insertMagicLink()` repo function
against the dev DB — deleted after use, never committed) and visiting
`/portal/magic-link?token=...` with it. This exercises the identical
frontend/backend code path a real emailed link would (`PortalMagicLinkConsume.tsx`
→ `api.customerMagicLinkConsume()` → the real route), differing only in
how the raw token reached the browser's address bar.

**Bug found and fixed during this manual QA pass.** A pre-existing global
CSS rule in `frontend/src/App.css` (`button { background: #2563eb; color:
white; }`, predating this app's Tailwind adoption) was silently painting
any `<button>` that didn't explicitly set its own `bg-`/`border-` classes
with a solid blue fill — invisible near-black text on a near-identical
blue background. This workstream's new "Email me a link instead" toggle
button hit it, and so, it turned out, did the pre-existing `PortalChat.tsx`
"Start over" button (W17, undetected until this pass's manual QA actually
looked at `/portal/chat` closely). Both fixed with an explicit
`border-none bg-transparent` on the button element; no other `<button>` in
the frontend was affected (the rest either use design-system's
`bg-ds-accent`-style classes or the pre-existing `.link-button` class,
which already overrides the same rule).

---

## 8. V5 Milestones (TDD, each green before the next)

| # | Milestone | Tests written first |
|---|---|---|
| V5-1 | `HLD_v5.md`/`LLD_v5.md`/`ticket_lifecycle_v5.mermaid` + draft CLAUDE.md invariant #8 amendment | n/a — docs milestone |
| V5-2 | Tailwind keyframe additions for `Carousel` (if needed beyond `transition-transform`) | n/a — config-only, verified in V5-4's manual QA |
| V5-3 | `GradientBlobBackground.tsx` extraction | manual QA: Landing/Login/Signup render pixel-identical to pre-extraction |
| V5-4 | `Carousel.tsx` | manual QA: autoplay, pause-on-hover, dot-nav, keyboard arrow-nav |
| V5-5 | `Footer.tsx` | manual QA |
| V5-6 | `ChatDemo.tsx` scripted conversation data + static-render component | manual QA |
| V5-7 | `ChatDemo.tsx` typewriter + stagger + loop wiring | manual QA: loop restarts cleanly, no memory leak on unmount mid-loop |
| V5-8 | `Landing.tsx` chat-demo integration, responsive check | manual QA |
| V5-9 | Testimonial content + `TestimonialCard.tsx` | manual QA |
| V5-10 | Carousel wiring for testimonials | manual QA (autoplay/pause/dot-nav/keyboard, per W21's checklist) |
| V5-11 | Footer content + `Landing.tsx` integration | manual QA |
| V5-12 | Login/Signup redesign (`GradientBlobBackground` + `scale-in`) | manual QA; existing login/signup submission flows unaffected |
| V5-13 | Dashboard redesign (`scale-in` on KPI tiles + layout pass) | manual QA |
| V5-14 | W21-W24 regression | `npm run typecheck`/`build` clean; manual QA across Landing/Login/Signup/Dashboard |
| V5-15 | `EmailAdapter`/`MockEmailAdapter`/`createEmailAdapter` | unit tests: tier resolution from env, `hosted` inferred from `EMAIL_API_KEY`, distinct-credential assertion (never reuses `OPENAI_API_KEY`/`EMBEDDINGS_API_KEY`) |
| V5-16 | `EmailHttpAdapter` | unit test against a stubbed `fetch` (both `local`- and `hosted`-tier construction, same Resend-shaped request body — see §6's as-built note on why both tiers share one payload shape) |
| V5-17 | `customer_magic_links` migration + `mlk_` prefix | migration up/down test |
| V5-18 | `customerMagicLinksRepo.ts` | insert/find/consume round-trip; org-isolation; expired-excluded; already-consumed-excluded; concurrent-consume race resolves to exactly one winner |
| V5-19 | `POST /customer-auth/magic-link/request` | generic-200-regardless-of-match test; per-IP rate-limit test; per-customer abuse-guard test; email content assertion via `MockEmailAdapter.sent` |
| V5-20 | `POST /customer-auth/magic-link/consume` | happy path (30d expiry on issued token); expired-token rejected; **already-consumed token rejected, not replayed** (explicit contrast test vs. invariant #7); tampered/unknown-token rejected |
| V5-21 | `signCustomerToken()` optional-expiry extension + full W25 regression | existing `customerAuth` suite green unchanged; `/verify`'s 1h expiry confirmed byte-identical to v4 |
| V5-22 | `PortalVerify`/`PortalChat` visual pass | manual QA |
| V5-23 | Magic-link request UI + `PortalMagicLinkConsume.tsx` + `/portal/magic-link` route + `api.ts` methods | manual QA against W25's live backend (request form + generic confirmation live in-browser; auto-consume/expired-replay/returning-customer-skip via a directly-seeded `customer_magic_links` row — see §7's as-built note on why no Mailpit-UI walkthrough was used) |
| V5-24 | Returning-customer skip-to-chat behavior | manual QA: stored token (either kind) skips both verify forms |
| V5-25 | CLAUDE.md invariant #8 amendment finalized; consumed-magic-link-replay adversarial integration test | integration test, permanent alongside eval_005/006/007 and the v4 portal-injection test |
| V5-26 | Doc reconciliation: `HLD_v5.md`/`LLD_v5.md`/`ticket_lifecycle_v5.mermaid`/`CLAUDE.md` checked against what was actually built | n/a — docs milestone |
| V5-27 | Final regression | full v1-v5 suite green incl. eval_005/006/007, v4's portal-injection test, and V5-25's magic-link-replay test; `npm run smoke:local` re-verified; manual demo walkthrough covering Landing (chat demo/testimonials/footer), Login/Signup/Dashboard (redesign), and `/portal/*` (both entry paths + returning-customer skip) |

**Standing regression rule (unchanged since v1, extended each version):**
the full v1-v4 suite, including eval_005/006/007 and v4's portal-injection
adversarial test, runs green at the end of every v5 milestone; from V5-25
onward, the new magic-link-replay adversarial test joins that permanent
set.
