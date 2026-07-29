import { useState } from "react";
import { api, setToken, setRole, setOrg, type Role } from "../api.js";

export function Login({
  onLogin,
}: {
  onLogin: (displayName: string, role: Role, orgId: string, orgName: string) => void;
}) {
  const [username, setUsername] = useState("agent1");
  const [password, setPassword] = useState("agent123");
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
      onLogin(result.user.display_name, result.user.role, result.org.org_id, result.org.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>TrustDesk</h1>
        <p className="hint">Demo accounts: agent1/agent123, manager1/manager123, admin1/admin123</p>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
