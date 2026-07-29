import { Link } from "react-router-dom";

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
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 animate-blob rounded-full bg-ds-accent/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[-8rem] top-24 h-96 w-96 animate-blob rounded-full bg-status-info-fg/20 blur-3xl [animation-delay:-4s]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-6rem] left-1/3 h-80 w-80 animate-blob rounded-full bg-status-success-fg/20 blur-3xl [animation-delay:-8s]"
      />

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

        <div className="mt-20 grid gap-6 text-left sm:grid-cols-3">
          <div className="group animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface p-6 shadow-sm transition-all duration-300 [animation-delay:320ms] hover:-translate-y-1 hover:shadow-lg">
            <div className="text-sm font-semibold text-ds-accent transition-colors group-hover:text-ds-text">
              Pick your vertical
            </div>
            <p className="mt-2 text-sm text-ds-text-muted">
              Retail &amp; e-commerce, software, or finance — each ships with a starter policy pack and demo
              customers so you can test the flow immediately.
            </p>
          </div>
          <div className="group animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface p-6 shadow-sm transition-all duration-300 [animation-delay:400ms] hover:-translate-y-1 hover:shadow-lg">
            <div className="text-sm font-semibold text-ds-accent transition-colors group-hover:text-ds-text">
              Guardrails by default
            </div>
            <p className="mt-2 text-sm text-ds-text-muted">
              Prompt-injection scanning, output leak detection, and approval-gated tool actions — every AI run is
              logged with its full guardrail trace.
            </p>
          </div>
          <div className="group animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface p-6 shadow-sm transition-all duration-300 [animation-delay:480ms] hover:-translate-y-1 hover:shadow-lg">
            <div className="text-sm font-semibold text-ds-accent transition-colors group-hover:text-ds-text">
              Humans stay in control
            </div>
            <p className="mt-2 text-sm text-ds-text-muted">
              Routine, low-risk replies auto-send; anything escalated, policy-refused, or requiring approval waits
              for your team. Taking over a thread is always one click away.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
