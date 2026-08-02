import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, setOrg, setRole, setToken, setWelcomeSeenAt, type Role, type Vertical } from "../api.js";
import { GradientBlobBackground } from "../design-system/GradientBlobBackground.js";

const VERTICALS: { value: Vertical; label: string }[] = [
  { value: "retail_ecommerce", label: "Retail & e-commerce" },
  { value: "software", label: "Software" },
  { value: "finance", label: "Finance" },
];

// V3-3/V3-8 (LLD_v3 §2/§6, HLD_v3 ADR-14): public self-serve org signup.
// Same request shape as the admin-only org-onboarding form (Admin.tsx),
// exposed here without auth. On success: auto-login (token/role/org already
// come back from POST /signup) and redirect straight into the app.
export function Signup({
  onSignedUp,
}: {
  onSignedUp: (displayName: string, role: Role, orgId: string, orgName: string, welcomeSeenAt: string | null) => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState<Vertical>("retail_ecommerce");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.signup({
        name,
        vertical,
        admin_username: adminUsername,
        admin_password: adminPassword,
        admin_display_name: adminDisplayName,
      });
      setToken(result.token);
      setRole(result.user.role);
      setOrg(result.org.org_id, result.org.name);
      setWelcomeSeenAt(result.user.welcome_seen_at);
      onSignedUp(
        result.user.display_name,
        result.user.role,
        result.org.org_id,
        result.org.name,
        result.user.welcome_seen_at
      );
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ds-bg px-4 py-12">
      <GradientBlobBackground variant="auth" />

      <div className="relative w-full max-w-md animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface/90 p-8 shadow-xl backdrop-blur">
        <Link to="/" className="text-sm text-ds-text-muted transition-colors hover:text-ds-text">
          ← Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-ds-text">Onboard your organization</h1>
        <p className="mt-1 text-sm text-ds-text-muted">
          You'll be signed in immediately as the org's admin — pick your own credentials below.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="animate-scale-in">
            <label className="block text-sm font-medium text-ds-text">
              Organization name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              />
            </label>
          </div>
          <div className="animate-scale-in [animation-delay:70ms]">
            <label className="block text-sm font-medium text-ds-text">
              Support vertical
              <select
                value={vertical}
                onChange={(e) => setVertical(e.target.value as Vertical)}
                className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              >
                {VERTICALS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="animate-scale-in [animation-delay:140ms]">
            <label className="block text-sm font-medium text-ds-text">
              Your name
              <input
                value={adminDisplayName}
                onChange={(e) => setAdminDisplayName(e.target.value)}
                required
                className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              />
            </label>
          </div>
          <div className="animate-scale-in [animation-delay:210ms]">
            <label className="block text-sm font-medium text-ds-text">
              Admin username
              <input
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                required
                className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              />
            </label>
          </div>
          <div className="animate-scale-in [animation-delay:280ms]">
            <label className="block text-sm font-medium text-ds-text">
              Admin password
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                minLength={8}
                required
                className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              />
            </label>
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
            {busy ? "Creating your workspace…" : "Create workspace"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ds-text-muted">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-ds-accent">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
