import { useState } from "react";
import { api } from "../api.js";

// V3-7/V3-8 (LLD_v3 §5, HLD_v3 ADR-17): shown only when the logged-in user's
// welcome_seen_at is null (first login after signup/invite) — dismissing it
// calls POST /users/me/welcome-seen once, which is set-once/permanent.
// V3-9 follow-up: redesigned — the previous "Dismiss" button set a muted
// text color with no explicit background, so it silently inherited the
// global `button { background: #2563eb }` rule from App.css and rendered
// as unreadable gray-on-blue. Every button here now sets its background
// explicitly.
export function WelcomeBanner({ orgName, onDismiss }: { orgName: string; onDismiss: () => void }) {
  const [dismissing, setDismissing] = useState(false);

  async function dismiss() {
    setDismissing(true);
    try {
      await api.markWelcomeSeen();
    } finally {
      onDismiss();
    }
  }

  return (
    <div className="relative mb-6 animate-fade-in-up overflow-hidden rounded-ds-lg border border-ds-accent/20 bg-gradient-to-br from-ds-accent/10 via-ds-surface to-status-success-fg/10 p-5 shadow-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-ds-accent/10 blur-2xl"
      />
      <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ds-accent text-lg font-bold text-ds-accent-contrast shadow-sm">
            ✓
          </div>
          <div>
            <div className="text-sm font-semibold text-ds-text">Welcome to TrustDesk, {orgName}!</div>
            <p className="mt-1 max-w-2xl text-sm text-ds-text-muted">
              Your workspace is set up with demo customers and a starter policy pack. Head to the ticket queue to
              try the AI triage/draft pipeline, or visit Admin to invite your team and configure platform support.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={dismissing}
          className="shrink-0 self-end rounded-ds-md border border-ds-border bg-ds-surface px-3 py-1.5 text-sm font-medium text-ds-text shadow-sm transition-colors hover:bg-ds-border/40 disabled:opacity-50 sm:self-auto"
        >
          {dismissing ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
