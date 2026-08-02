import { Link } from "react-router-dom";
import { GradientBlobBackground } from "../design-system/GradientBlobBackground.js";
import { ChatDemo } from "../design-system/ChatDemo.js";
import { Carousel } from "../design-system/Carousel.js";
import { TestimonialCard } from "../design-system/TestimonialCard.js";
import { Footer } from "../design-system/Footer.js";

// V5-9 (LLD_v5 §4, HLD_v5 ADR-26): fictional placeholder testimonials —
// capstone context, not user-generated content.
const TESTIMONIALS = [
  {
    quote:
      "We had guardrailed AI replies going out within a day of signing up. The approval queue means nothing risky ever ships without a human looking at it first.",
    name: "Priya Nair",
    role: "Head of Support, Fernway Retail",
  },
  {
    quote:
      "The auto-triage alone paid for itself — tickets used to sit for hours before anyone even read them. Now they're categorized and routed the moment they land.",
    name: "Marcus Webb",
    role: "Support Lead, Northlane Software",
  },
  {
    quote:
      "What sold us was the audit trail. Every AI decision is logged with its guardrail trace, so when compliance asks questions we actually have answers.",
    name: "Elena Cruz",
    role: "Operations Manager, Cedar Finance",
  },
];

// V3-1/V3-8 (HLD_v3 ADR-14, LLD_v3 §6): public marketing/onboarding entry
// point — the customer onboarding flow the v3 request opened with. No auth,
// no data fetching; pure static page describing TrustDesk and routing
// prospective tenants to /signup (self-serve) or existing tenants to /login.
// V3-9 follow-up: modernized visual pass — gradient hero, soft animated
// blobs, and staggered fade-in-up entrances (all CSS-only, no JS animation
// library — see tailwind.config.js's keyframes).
export function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-ds-bg text-ds-text">
      <GradientBlobBackground variant="landing" />

      <header className="relative flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-ds-md bg-ds-accent text-sm font-bold text-ds-accent-contrast">
            TD
          </span>
          TrustDesk
        </div>
        <nav className="flex items-center gap-4">
          <Link to="/login" className="text-sm font-medium text-ds-text-muted transition-colors hover:text-ds-text">
            Log in
          </Link>
          <Link
            to="/signup"
            className="rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-medium text-ds-accent-contrast shadow-sm transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main className="relative mx-auto max-w-4xl px-8 py-16 text-center">
        <div className="mx-auto mb-6 w-fit animate-fade-in-up rounded-full border border-ds-border bg-ds-surface/80 px-4 py-1 text-xs font-medium text-ds-text-muted shadow-sm backdrop-blur">
          Guardrailed AI support, live in minutes
        </div>

        <h1 className="animate-fade-in-up text-4xl font-bold tracking-tight sm:text-5xl [animation-delay:80ms]">
          AI-assisted customer support,
          <br className="hidden sm:block" /> with humans always in the loop.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl animate-fade-in-up text-lg text-ds-text-muted [animation-delay:160ms]">
          TrustDesk triages tickets, retrieves your policy docs, and drafts guardrail-checked replies — auto-sending
          the routine ones and handing anything sensitive to your team. Every AI action is logged, every risky tool
          call needs approval, and a human can take over any thread at any time.
        </p>
        <div className="mt-10 flex animate-fade-in-up justify-center gap-4 [animation-delay:240ms]">
          <Link
            to="/signup"
            className="rounded-ds-md bg-ds-accent px-6 py-3 text-base font-semibold text-ds-accent-contrast shadow-md transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            Onboard your team
          </Link>
          <Link
            to="/login"
            className="rounded-ds-md border border-ds-border bg-ds-surface/60 px-6 py-3 text-base font-semibold text-ds-text backdrop-blur transition-colors hover:bg-ds-surface"
          >
            I already have an account
          </Link>
        </div>

        <div className="mt-16 grid animate-fade-in-up items-center gap-10 text-left [animation-delay:320ms] sm:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ds-text">See it triage a ticket, live</h2>
            <p className="mt-3 text-ds-text-muted">
              Every inbound message runs through the same pipeline you'll see in your own dashboard — no demo-only
              shortcuts.
            </p>
            <ul className="mt-6 space-y-3">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ds-accent" />
                <span className="text-sm text-ds-text-muted">
                  <strong className="font-semibold text-ds-text">Auto-triage</strong> — every message is categorized
                  and prioritized the instant it arrives.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ds-accent" />
                <span className="text-sm text-ds-text-muted">
                  <strong className="font-semibold text-ds-text">Guardrail-checked drafts</strong> — replies are
                  scanned before they ever reach a customer.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ds-accent" />
                <span className="text-sm text-ds-text-muted">
                  <strong className="font-semibold text-ds-text">Human handoff, anytime</strong> — your team can take
                  over any thread with one click.
                </span>
              </li>
            </ul>
          </div>
          <ChatDemo />
        </div>

        <div className="mt-16 grid gap-6 text-left sm:grid-cols-3">
          <div className="group animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface p-6 shadow-sm transition-all duration-300 [animation-delay:400ms] hover:-translate-y-1 hover:shadow-lg">
            <div className="text-sm font-semibold text-ds-accent transition-colors group-hover:text-ds-text">
              Pick your vertical
            </div>
            <p className="mt-2 text-sm text-ds-text-muted">
              Retail &amp; e-commerce, software, or finance — each ships with a starter policy pack and demo
              customers so you can test the flow immediately.
            </p>
          </div>
          <div className="group animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface p-6 shadow-sm transition-all duration-300 [animation-delay:480ms] hover:-translate-y-1 hover:shadow-lg">
            <div className="text-sm font-semibold text-ds-accent transition-colors group-hover:text-ds-text">
              Guardrails by default
            </div>
            <p className="mt-2 text-sm text-ds-text-muted">
              Prompt-injection scanning, output leak detection, and approval-gated tool actions — every AI run is
              logged with its full guardrail trace.
            </p>
          </div>
          <div className="group animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface p-6 shadow-sm transition-all duration-300 [animation-delay:560ms] hover:-translate-y-1 hover:shadow-lg">
            <div className="text-sm font-semibold text-ds-accent transition-colors group-hover:text-ds-text">
              Humans stay in control
            </div>
            <p className="mt-2 text-sm text-ds-text-muted">
              Routine, low-risk replies auto-send; anything escalated, policy-refused, or requiring approval waits
              for your team. Taking over a thread is always one click away.
            </p>
          </div>
        </div>

        <div className="mt-20">
          <h2 className="text-2xl font-bold tracking-tight text-ds-text">Trusted by support teams</h2>
          <div className="mx-auto mt-8 max-w-xl">
            <Carousel>
              {TESTIMONIALS.map((t) => (
                <TestimonialCard key={t.name} {...t} />
              ))}
            </Carousel>
          </div>
        </div>
      </main>
      <Footer className="mt-20" />
    </div>
  );
}
