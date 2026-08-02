import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, hasValidCustomerSession, setCustomerSession } from "../api.js";
import { GradientBlobBackground } from "../design-system/GradientBlobBackground.js";

// W17 (LLD_v4 §7, HLD_v4 ADR-23): the POST /customer-auth/verify form.
// W26 (LLD_v5 §7, HLD_v5 ADR-28/29): visual pass onto GradientBlobBackground
// + scale-in/fade-in-up, a returning-customer skip-to-chat check, and a
// second "email me a link instead" form posting to the new magic-link
// request route — a toggle alongside the original form, never a replacement.
export function PortalVerify() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"verify" | "magic-link">("verify");

  const [orgSlug, setOrgSlug] = useState("");
  const [email, setEmail] = useState("");
  // Exactly one of these two is sent — mirrors the backend's
  // CustomerVerifyRequest exactly-one-of refinement (src/domain/authTypes.ts).
  const [identifierKind, setIdentifierKind] = useState<"order_id" | "ticket_id">("order_id");
  const [identifierValue, setIdentifierValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [linkOrgSlug, setLinkOrgSlug] = useState("");
  const [linkEmail, setLinkEmail] = useState("");
  const [linkTicketId, setLinkTicketId] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSubmitted, setLinkSubmitted] = useState(false);

  // Returning-customer skip (LLD_v5 §7): a still-valid stored session — of
  // either kind, manual-verify or magic-link-derived, both share the same
  // CustomerTokenClaims shape — means this form never needs to render at all.
  if (hasValidCustomerSession()) {
    return <Navigate to="/portal/chat" replace />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.customerVerify(
        identifierKind === "order_id"
          ? { org_slug: orgSlug, email, order_id: identifierValue }
          : { org_slug: orgSlug, email, ticket_id: identifierValue }
      );
      setCustomerSession(result.customer_token, result.ticket_id ?? null);
      navigate("/portal/chat", { replace: true });
    } catch (err) {
      // V4-20 (LLD_v4 §7): the backend deliberately returns one generic
      // message for every failure (unknown org, unknown email, mismatched
      // identifier) — this form just surfaces it verbatim, no extra
      // client-side guessing of what went wrong.
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLinkBusy(true);
    try {
      // V5-19: always resolves — the backend returns an identical generic
      // 200 regardless of whether the email matched. This form must not
      // introduce a client-side tell the backend deliberately avoids, so the
      // confirmation below is shown unconditionally, never branched on
      // whether a real link was actually sent.
      await api.customerMagicLinkRequest(linkOrgSlug, linkEmail, linkTicketId || undefined);
    } finally {
      setLinkBusy(false);
      setLinkSubmitted(true);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ds-bg px-4">
      <GradientBlobBackground variant="portal" />

      <div className="relative w-full max-w-sm animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface/90 p-8 shadow-xl backdrop-blur">
        <h1 className="text-xl font-bold text-ds-text">Continue as a customer</h1>
        <p className="mt-2 text-sm text-ds-text-muted">
          {mode === "verify"
            ? "Verify your order or ticket to start chatting with support."
            : "We'll email you a one-time link to jump straight into your conversation."}
        </p>

        {mode === "verify" ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="animate-scale-in">
              <label className="block text-sm font-medium text-ds-text">
                Organization
                <input
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value)}
                  placeholder="e.g. WIDGETS-INC"
                  autoFocus
                  required
                  className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
                />
              </label>
            </div>
            <div className="animate-scale-in [animation-delay:60ms]">
              <label className="block text-sm font-medium text-ds-text">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
                />
              </label>
            </div>

            <div className="animate-scale-in flex gap-4 text-sm text-ds-text [animation-delay:120ms]">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={identifierKind === "order_id"}
                  onChange={() => setIdentifierKind("order_id")}
                />
                Order ID
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={identifierKind === "ticket_id"}
                  onChange={() => setIdentifierKind("ticket_id")}
                />
                Ticket ID
              </label>
            </div>
            <div className="animate-scale-in [animation-delay:180ms]">
              <input
                value={identifierValue}
                onChange={(e) => setIdentifierValue(e.target.value)}
                placeholder={identifierKind === "order_id" ? "e.g. ord_5001" : "e.g. tkt_9001"}
                required
                className="w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              />
            </div>

            {error && <p className="animate-scale-in text-sm text-status-danger-fg">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-semibold text-ds-accent-contrast transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            >
              {busy && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ds-accent-contrast/40 border-t-ds-accent-contrast" />
              )}
              {busy ? "Verifying…" : "Continue"}
            </button>
          </form>
        ) : linkSubmitted ? (
          <div className="animate-scale-in mt-6 rounded-ds-md bg-status-info-bg px-4 py-3 text-sm text-status-info-fg">
            If that email matches an account, a link has been sent. Check your inbox — it expires in 15 minutes.
          </div>
        ) : (
          <form onSubmit={handleMagicLinkSubmit} className="mt-6 space-y-4">
            <div className="animate-scale-in">
              <label className="block text-sm font-medium text-ds-text">
                Organization
                <input
                  value={linkOrgSlug}
                  onChange={(e) => setLinkOrgSlug(e.target.value)}
                  placeholder="e.g. WIDGETS-INC"
                  autoFocus
                  required
                  className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
                />
              </label>
            </div>
            <div className="animate-scale-in [animation-delay:60ms]">
              <label className="block text-sm font-medium text-ds-text">
                Email
                <input
                  type="email"
                  value={linkEmail}
                  onChange={(e) => setLinkEmail(e.target.value)}
                  required
                  className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
                />
              </label>
            </div>
            <div className="animate-scale-in [animation-delay:120ms]">
              <label className="block text-sm font-medium text-ds-text">
                Ticket ID <span className="text-ds-text-muted">(optional)</span>
                <input
                  value={linkTicketId}
                  onChange={(e) => setLinkTicketId(e.target.value)}
                  placeholder="e.g. tkt_9001"
                  className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={linkBusy}
              className="flex w-full items-center justify-center gap-2 rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-semibold text-ds-accent-contrast transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
            >
              {linkBusy && (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ds-accent-contrast/40 border-t-ds-accent-contrast" />
              )}
              {linkBusy ? "Sending…" : "Email me a link"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "verify" ? "magic-link" : "verify");
            setLinkSubmitted(false);
            setError(null);
          }}
          className="mt-4 w-full border-none bg-transparent text-center text-sm font-medium text-ds-accent underline-offset-2 hover:underline"
        >
          {mode === "verify" ? "Email me a link instead" : "← Back to manual verification"}
        </button>
      </div>
    </div>
  );
}
