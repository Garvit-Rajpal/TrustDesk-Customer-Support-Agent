import { useState } from "react";
import { api, type InviteUserResult, type Role } from "../api.js";

// V2-2 (LLD_v2 §3/§8/§9, ADR-9): "Admin-only POST /users/invite replaces
// 'no signup' as the account-creation path." This page is the only place
// a new TrustDesk account gets created — reachable only when Shell shows
// the Admin nav item, which App.tsx gates on role === "admin"; the backend
// enforces the same thing independently via requirePermission("users:invite").
export function Admin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [created, setCreated] = useState<InviteUserResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await api.inviteUser({ username, password, display_name: displayName, role });
      setCreated(result);
      setUsername("");
      setPassword("");
      setDisplayName("");
      setRole("agent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Admin — invite user</h2>
      <p className="muted">Creates an account directly (no email step in this demo).</p>

      <form onSubmit={handleSubmit} className="ingest-form">
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Password (min 8 characters)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="agent">agent</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Inviting…" : "Invite user"}
        </button>
      </form>

      {created && (
        <p className="muted">
          Created <code>{created.username}</code> ({created.role}) — they can log in immediately.
        </p>
      )}
    </div>
  );
}
