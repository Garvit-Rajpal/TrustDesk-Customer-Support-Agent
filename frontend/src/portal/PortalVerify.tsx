import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setCustomerSession } from "../api.js";

// W17 (LLD_v4 §7, HLD_v4 ADR-23): the POST /customer-auth/verify form.
// Minimally styled in v4 (functional; visual pass is v5 per HLD_v4 ADR-24)
// — plain form, no gradient/blob treatment Login/Signup use.
export function PortalVerify() {
  const navigate = useNavigate();
  const [orgSlug, setOrgSlug] = useState("");
  const [email, setEmail] = useState("");
  // Exactly one of these two is sent — mirrors the backend's
  // CustomerVerifyRequest exactly-one-of refinement (src/domain/authTypes.ts).
  const [identifierKind, setIdentifierKind] = useState<"order_id" | "ticket_id">("order_id");
  const [identifierValue, setIdentifierValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="flex min-h-screen items-center justify-center bg-ds-bg px-4">
      <div className="w-full max-w-sm rounded-ds-lg border border-ds-border bg-ds-surface p-8 shadow-sm">
        <h1 className="text-xl font-bold text-ds-text">Continue as a customer</h1>
        <p className="mt-2 text-sm text-ds-text-muted">
          Verify your order or ticket to start chatting with support.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-ds-text">
            Organization
            <input
              value={orgSlug}
              onChange={(e) => setOrgSlug(e.target.value)}
              placeholder="e.g. WIDGETS-INC"
              autoFocus
              required
              className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ds-accent/40"
            />
          </label>
          <label className="block text-sm font-medium text-ds-text">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ds-accent/40"
            />
          </label>

          <div className="flex gap-4 text-sm text-ds-text">
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
          <input
            value={identifierValue}
            onChange={(e) => setIdentifierValue(e.target.value)}
            placeholder={identifierKind === "order_id" ? "e.g. ord_5001" : "e.g. tkt_9001"}
            required
            className="w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ds-accent/40"
          />

          {error && <p className="text-sm text-status-danger-fg">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-semibold text-ds-accent-contrast disabled:opacity-50"
          >
            {busy ? "Verifying…" : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
