import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, setCustomerSession } from "../api.js";
import { GradientBlobBackground } from "../design-system/GradientBlobBackground.js";

// V5-23 (LLD_v5 §7, HLD_v5 ADR-29): mounted at /portal/magic-link. Reads
// `token` from the query string and auto-consumes on mount (no intermediate
// "Continue" click, per the confirmed UX decision) — success stores the
// session and hands off to /portal/chat, failure shows a message pointing
// back to the manual-verify form since a consumed/expired token can never
// succeed on retry by design.
export function PortalMagicLinkConsume() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"pending" | "error">("pending");
  // StrictMode double-invokes effects in dev — this guards against
  // double-consuming the single-use token against the real backend.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const token = searchParams.get("token");
    if (!token) {
      setStatus("error");
      return;
    }

    api
      .customerMagicLinkConsume(token)
      .then((result) => {
        setCustomerSession(result.customer_token, result.ticket_id ?? null);
        navigate("/portal/chat", { replace: true });
      })
      .catch(() => setStatus("error"));
  }, [searchParams, navigate]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ds-bg px-4">
      <GradientBlobBackground variant="portal" />

      <div className="relative w-full max-w-sm animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface/90 p-8 text-center shadow-xl backdrop-blur">
        {status === "pending" ? (
          <div className="animate-scale-in">
            <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-ds-accent/30 border-t-ds-accent" />
            <p className="mt-4 text-sm text-ds-text-muted">Signing you in…</p>
          </div>
        ) : (
          <div className="animate-scale-in">
            <h1 className="text-lg font-bold text-ds-text">Link expired or already used</h1>
            <p className="mt-2 text-sm text-ds-text-muted">
              This link has expired or was already used. Magic links are single-use and only valid for 15 minutes.
            </p>
            <Link
              to="/portal/verify"
              className="mt-6 inline-block rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-semibold text-ds-accent-contrast transition-transform hover:scale-[1.01]"
            >
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
