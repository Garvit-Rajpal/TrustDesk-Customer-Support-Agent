import { useState } from "react";
import { Link } from "react-router-dom";
import { api, setOrg, setRole, setToken, setWelcomeSeenAt, type Role } from "../api.js";
import { GradientBlobBackground } from "../design-system/GradientBlobBackground.js";

// V3-9 follow-up (LLD_v3 §6, HLD_v3 ADR-18): brought onto the same
// gradient/card language as Landing/Signup — no functional change from the
// original, just a modernized Tailwind shell. Demo credentials used to be
// printed on this page as a hint; that's gone now (not something a
// production login screen should ever show).
export function Login({
  onLogin,
}: {
  onLogin: (displayName: string, role: Role, orgId: string, orgName: string, welcomeSeenAt: string | null) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await api.login(username, password);
      setToken(result.token);
      setRole(result.user.role);
      setOrg(result.org.org_id, result.org.name);
      setWelcomeSeenAt(result.user.welcome_seen_at);
      onLogin(result.user.display_name, result.user.role, result.org.org_id, result.org.name, result.user.welcome_seen_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ds-bg px-4">
      <GradientBlobBackground variant="auth" />

      <div className="relative w-full max-w-sm animate-fade-in-up rounded-ds-lg border border-ds-border bg-ds-surface/90 p-8 shadow-xl backdrop-blur">
        <Link to="/" className="text-sm text-ds-text-muted transition-colors hover:text-ds-text">
          ← Back
        </Link>

        <div className="mt-3 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-ds-md bg-ds-accent text-sm font-bold text-ds-accent-contrast">
            TD
          </div>
          <h1 className="text-2xl font-bold text-ds-text">TrustDesk</h1>
        </div>
        <p className="mt-2 text-sm text-ds-text-muted">Welcome back — sign in to your workspace.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="animate-scale-in">
            <label className="block text-sm font-medium text-ds-text">
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
                className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              />
            </label>
          </div>
          <div className="animate-scale-in [animation-delay:80ms]">
            <label className="block text-sm font-medium text-ds-text">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1 w-full rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ds-accent/40"
              />
            </label>
          </div>

          {error && <p className="animate-scale-in text-sm text-status-danger-fg">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-semibold text-ds-accent-contrast transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:hover:scale-100"
          >
            {loading && (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ds-accent-contrast/40 border-t-ds-accent-contrast" />
            )}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ds-text-muted">
          New to TrustDesk?{" "}
          <Link to="/signup" className="font-medium text-ds-accent">
            Onboard your org
          </Link>
        </p>
      </div>
    </div>
  );
}
