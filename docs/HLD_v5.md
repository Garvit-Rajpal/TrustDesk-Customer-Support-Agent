# TrustDesk — HLD v5 (Product Extension)

**Version:** 5.0 · **Extends:** `HLD_v4.md` (v1/v2/v3/v4 remain valid; this document only adds and amends) · **Status:** Agreed baseline for LLD v5

V4 shipped seven working tracks — richer demo data, real ticket rendering,
eval-run streaming, similarity-grounded drafts, layered guardrails, and the
biggest new surface, a customer-facing chat portal — but deliberately kept
the frontend pass to "cheap wins" (favicon, typography, one chart restyle)
and left `/portal/*` "functional but minimally styled," naming both as v5
candidates explicitly rather than silently deferring them (`HLD_v4.md`
§8). V5 closes that gap: the deferred visual/UX work, plus one genuinely
new capability HLD_v4 §8 also flagged — a magic-link, email-verified path
onto the existing customer-portal session, since today's `CustomerToken` is
strictly per-verification (1h, re-verify to renew) rather than something a
returning customer can reuse.

**Docs-first, same convention as every prior version.** This document and
`LLD_v5.md` are written *before* any v5 code changes, as the spec W21-W27
implement against.

**V5 workstreams and build order:**

| # | Workstream | Depends on |
|---|---|---|
| W20 | This document + `LLD_v5.md` + `ticket_lifecycle_v5.mermaid` + CLAUDE.md draft amendment | W19 (v4 complete) |
| W21 | Shared visual/animation primitives (`GradientBlobBackground`, `Carousel`, `Footer`, new keyframes) | W20 |
| W22 | Animated landing-page chat demo | W21 |
| W23 | Testimonials carousel + footer | W21 |
| W24 | Login/Signup/Dashboard deep visual redesign | W21 |
| W25 | Magic-link auth backend (email adapter trio, `customer_magic_links`, request/consume routes) | W20 |
| W26 | `/portal/*` visual pass + magic-link portal UI integration | W21, W25 |
| W27 | Doc reconciliation + final regression | everything |

**Compatibility guarantee:** every v1-v4 test stays green throughout. The
one new DB table (`customer_magic_links`, W25) is additive. No existing
route's request/response shape changes — `POST /customer-auth/verify`'s
behavior and 1h expiry are byte-identical to v4; magic-link is a new,
parallel entry path onto the same `CustomerTokenClaims` shape, never a
replacement.

**Scope note:** per the project owner's decision, the v4-flagged cross-org
"pattern sharing" Future Work proposal (`HLD_v4.md` §"Future Work") stays
out of scope for v5 — it remains a fully specified, not-implemented design
doc, picked up only in a future round if ever pursued.

---

## New ADRs

### ADR-25: Shared visual/animation primitive layer (W21)

`Landing.tsx`, `Login.tsx`, and `Signup.tsx` each independently carry the
same three-`<div aria-hidden className="...animate-blob...">` gradient-blob
hero background markup — copy-pasted, not shared. V5's first workstream
extracts this into one `GradientBlobBackground` component before any new
page (Dashboard, `/portal/*`) adopts the same visual language, and adds two
more genuinely reusable pieces neither `Landing.tsx` nor any other page has
today: a generic, content-agnostic `Carousel` (for W23's testimonials) and
a presentational `Footer`.

**Recommendation carried forward, unchanged from HLD_v4 ADR-24: stay
CSS-only, do not add framer-motion.** The existing `useTypewriter` hook
(ADR-18) already proves the "it's alive" feel is achievable with zero new
dependencies via plain CSS/JS — `Carousel`'s auto-advance uses the same
primitive-timer pattern (`setInterval`, pause-on-hover, dot navigation),
not a library. This frontend has zero animation dependencies today; v5
keeps it that way. `scale-in` — a keyframe W18 added in v4 specifically as
groundwork for this pass but never gave a real consumer — gets its first
uses starting in W22.

### ADR-26: Landing-page chat demo + testimonials carousel + footer (W22, W23)

Two purely presentational, backend-free additions to `Landing.tsx`:

1. **Animated chat demo** — a scripted, hardcoded, looping conversation
   (`ChatDemo.tsx`) reusing `useTypewriter` per line plus staggered
   `scale-in`/`fade-in-up` bubble mounts. Zero backend calls, zero real AI
   — an explicit "Example conversation" label keeps it from reading as a
   live chat a visitor might try to type into (a UX/trust concern, not a
   security one, but worth naming: this is the landing page's first
   interactive-looking element that is not actually interactive).
2. **Testimonials carousel + footer** — `TestimonialCard.tsx` content
   wrapped in W21's `Carousel`, and `Footer.tsx` mounted at the page
   bottom. Testimonial copy is **fictional/placeholder**, explicitly stated
   here so it is never mistaken for real customer data — there is no new
   `testimonials` DB table; this is marketing copy, not user-generated
   content, and needs no persistence, no API, no org-scoping.

### ADR-27: Login/Signup/Dashboard deep visual redesign (W24)

v4's W18 (ADR-24) deliberately scoped its frontend work to "cheap wins":
favicon, a typography/nav pass on `Shell.tsx`, and a dashboard chart
restyle — plus, notably, it staged the `scale-in` Tailwind keyframe
specifically so a later pass could build on it, without using it itself.
`Login.tsx`/`Signup.tsx` separately picked up a lighter gradient/blob
treatment as an ad hoc "V3-9 follow-up," so neither page starts from zero,
but neither consolidated onto a shared component or used `scale-in`. W24 is
that consolidation: `Login.tsx`/`Signup.tsx` adopt `GradientBlobBackground`
(W21) and apply `scale-in` to form-field groups and error-message mounts;
`Dashboard.tsx`/`MetricTile.tsx` get a further layout/spacing pass and
`scale-in` on KPI-tile mount, building on (not replacing) W18's chart
restyle. The `dataviz` skill is only re-invoked if the chart palette or
layout materially changes — this pass is primarily animation/spacing, not a
new chart design.

### ADR-28: `/portal/*` visual design pass (W26, visual half)

`PortalVerify.tsx` and `PortalChat.tsx` have carried an explicit code
comment since v4 shipped: *"Minimally styled in v4 (functional; visual
pass is v5 per HLD_v4 ADR-24)"* — `PortalVerify.tsx` specifically notes it
is "a plain form, no gradient/blob treatment Login/Signup use." W26 closes
this out: both adopt `GradientBlobBackground` and `scale-in`/`fade-in-up`,
bringing the customer-facing portal onto the same visual language as the
agent-facing Landing/Login/Signup pages it has visually diverged from since
v4. This is purely presentational — no change to `usePortalSocket.ts`'s
connection logic or `PortalChat.tsx`'s message-rendering behavior.

### ADR-29: Magic-link customer auth (W25, W26 integration half)

HLD_v4 §8 named this explicitly as a v5+ candidate: *"magic-link/
email-verified customer sessions (today's `CustomerToken` is
per-verification, not persistent)."* Today, `POST /customer-auth/verify`
issues a `CustomerTokenClaims` token with a 1h expiry — every return visit
requires re-filling the verify form. V5 adds a second, **parallel** entry
path: a customer requests an emailed link, clicks it, and gets the
identical `CustomerTokenClaims` shape but with a longer, configurable
expiry (default 30 days), since out-of-band inbox access is a stronger,
longer-lived proof of identity than a single synchronous form submission.

**Two token universes, deliberately not conflated.** The magic-link token
itself — the opaque, random value embedded in the emailed URL — is **not**
a JWT and is never confused with the `CustomerToken` it ultimately mints.
It is a separate, server-side-stateful, single-use, short-lived (15 min)
secret: `crypto.randomBytes(32)`, stored only as its sha256 hash
(`customer_magic_links`, new table, §1 below), never the raw value. Only
successful, first-time consumption of a valid, unexpired, not-yet-consumed
token mints a `CustomerToken` — a second consumption attempt on the same
magic-link token is rejected, not replayed.

**This is deliberately the opposite of invariant #7's idempotency-key
semantics.** Invariant #7 says a replayed `idempotency_key` returns the
*same stored result* rather than re-executing — that is the correct
behavior for a tool-action POST a client might legitimately retry after a
dropped connection. A magic link is the opposite case: a second
"consumption" of the same link is far more likely to be an attacker who
intercepted the URL than the legitimate customer retrying, so it must
*fail*, not succeed a second time with a cached result. The two mechanisms
share no code and must not be pattern-matched against each other during
implementation.

**Supplements, does not replace, the manual form.** Per the project
owner's decision, `PortalVerify.tsx` gains a second "email me a link
instead" option; the existing `POST /customer-auth/verify` form keeps
working, unchanged, with its unchanged 1h expiry. A returning customer with
a still-valid stored `CustomerToken` (of either kind) skips straight to
`/portal/chat` without re-verifying at all — this is what actually
delivers the "reusable session" value HLD_v4 §8 flagged, and it benefits
existing manual-verify sessions too, not just magic-link ones.

**Non-enumeration, stronger than `/verify`'s.** `POST
/customer-auth/magic-link/request` always returns an identical generic 200
success, regardless of whether the supplied email actually matches a
customer — `/verify` already returns an identical generic 401 on every
failure path, but a *request* endpoint that emails a link has a stronger
obligation: it must never let a caller distinguish "email exists" from
"email doesn't exist" by response shape, timing, or side effect visible to
the caller (an actual email is only ever sent on a real match, but the
caller never learns which case occurred).

**New anti-abuse surface: per-customer rate limiting, not just per-IP.**
`/verify` and every existing public route rate-limits by IP alone. A
magic-link *request* endpoint introduces a new abuse shape once a real
email adapter exists — email-bombing a victim's real inbox with
unsolicited "verify your identity" links — that an IP-only limiter doesn't
cover (an attacker can rotate IPs; the target's email address is fixed).
`POST /magic-link/request` therefore adds a **second**, per-customer guard
(reject/no-op if too many non-expired links already exist for that
customer in the last hour) alongside the standard per-IP limiter.

**Session model: stateless, matching every other token in this app.** Per
the project owner's decision, the magic-link-derived `CustomerToken` stays
a stateless, longer-expiry JWT (`signCustomerToken()`'s `expiresIn` param
extended, default unchanged at `1h` for `/verify`, `30d` when minted via
magic-link) rather than a new DB-backed, revocable session table. This is
consistent with `TokenClaims` and today's `CustomerTokenClaims` both being
stateless JWTs; the tradeoff — no "log out everywhere" capability — is
accepted explicitly rather than silently, matching this project's own
posture on documenting rather than hiding limitations (the same posture
ADR-15 modeled for the L1-timing gap and ADR-23 modeled for the WS
single-process limitation).

**Amendment required.** Invariant #8 needs a **third** amendment (v3: org-
admin signup; v4: customer verification/chat portal) — the two amendments
already there both describe additive, non-account capability; this one
must make clear that a longer-lived token is a longer-lived instance of
the same non-account, non-password, non-`Role` token universe, not a
reversal of "no customer account system." Drafted in W20, finalized in W26
against what actually shipped (`CLAUDE.md` invariant #8).

---

## Amended sections

- **§3 Components (HLD v1, extended v2/v3/v4):** add `EmailAdapter`/
  `EmailService` (W25, mirrors `EmbeddingAdapter`'s interface+tiering
  shape exactly), `MagicLinkService` (request/consume orchestration,
  `src/api/routes/customerAuth.ts` extended), no new frontend "service"
  layer beyond the existing `design-system/` component additions (W21-W24,
  W26 visual half) since this app has no frontend state-management library
  to register components with.
- **§5 Guardrails:** unchanged in v5 — no new guardrail layer, no change to
  `GuardrailResult`, no change to the fail-closed substitution point. V5 is
  entirely UI/visual plus one new, narrowly-scoped auth surface that never
  touches the AI pipeline.
- **§8 Roadmap:** v5 implements the five items HLD_v4 §8 named as
  "New v5+ candidates" except two: horizontally scalable pipeline-event
  delivery (Redis pub/sub) and the cross-org pattern-sharing proposal both
  remain out of scope, un-implemented, and available for a future round.

## V5 traceability (capstone rubric)

W21-W24 and the visual half of W26 close out every "deferred to v5"
notation left in v4's own code comments and docs (`HLD_v4.md` ADR-24,
`PortalVerify.tsx`/`PortalChat.tsx`'s inline comments) — this is the
promised follow-through on v4's own explicit scoping decision, not new
scope invented after the fact. W25 and the integration half of W26 pick up
the one concrete v5+ candidate HLD_v4 §8 named with enough specificity to
implement (`"magic-link/email-verified customer sessions"`), while
explicitly leaving the other two named candidates (Redis pub/sub scaling,
cross-org pattern sharing) as documented, deliberate non-goals for this
round — the same "name what's deferred, don't silently drop it" discipline
v4 itself modeled.
