import { useEffect, useState } from "react";
import { api, type ConsentFlags, type CreateOrgResult, type InviteUserResult, type Role, type Vertical } from "../api.js";

// V2-2 (LLD_v2 §3/§8/§9, ADR-9): "Admin-only POST /users/invite replaces
// 'no signup' as the account-creation path." This page is the only place
// a new TrustDesk account gets created — reachable only when Shell shows
// the Admin nav item, which App.tsx gates on role === "admin"; the backend
// enforces the same thing independently via requirePermission("users:invite").
// V2-5 (LLD_v2 §6/§9): only org_default's admins may onboard new orgs — the
// backend enforces this independently (POST /orgs 403s otherwise); this
// just keeps the form from being offered to an admin who can't use it.
const PLATFORM_ORG_ID = "org_default";

export function Admin({ orgId }: { orgId: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [created, setCreated] = useState<InviteUserResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // V2-5 (LLD_v2 §6/§8): "onboard orgs" admin page. Separate state from the
  // invite form above — they hit different endpoints and don't share fields.
  const [orgName, setOrgName] = useState("");
  const [vertical, setVertical] = useState<Vertical>("retail_ecommerce");
  const [orgAdminUsername, setOrgAdminUsername] = useState("");
  const [orgAdminPassword, setOrgAdminPassword] = useState("");
  const [orgAdminDisplayName, setOrgAdminDisplayName] = useState("");
  const [orgCreated, setOrgCreated] = useState<CreateOrgResult | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);

  // V3-6/V3-9 (LLD_v3 §4, HLD_v3 ADR-16): org-wide, independently toggleable
  // consent flags — scoped to the caller's own org (backend enforces this,
  // see GET/PUT /orgs/consent).
  const [consent, setConsent] = useState<ConsentFlags | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  useEffect(() => {
    api
      .getConsent()
      .then(setConsent)
      .catch((err) => setConsentError(err instanceof Error ? err.message : "Failed to load consent settings"));
  }, []);

  async function toggleConsent(field: keyof ConsentFlags) {
    if (!consent) return;
    setConsentError(null);
    setConsentBusy(true);
    try {
      const updated = await api.updateConsent({ [field]: !consent[field] });
      setConsent(updated);
    } catch (err) {
      setConsentError(err instanceof Error ? err.message : "Failed to update consent settings");
    } finally {
      setConsentBusy(false);
    }
  }

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setOrgError(null);
    setOrgBusy(true);
    try {
      const result = await api.createOrg({
        name: orgName,
        vertical,
        admin_username: orgAdminUsername,
        admin_password: orgAdminPassword,
        admin_display_name: orgAdminDisplayName,
      });
      setOrgCreated(result);
      setOrgName("");
      setOrgAdminUsername("");
      setOrgAdminPassword("");
      setOrgAdminDisplayName("");
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Org creation failed");
    } finally {
      setOrgBusy(false);
    }
  }

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

      <h2 className="mt-6">Admin — platform support consent</h2>
      <p className="muted">
        Optionally let TrustDesk's platform operator view your tickets (read-only) or quality metrics — off by
        default, independently toggleable, never per-ticket.
      </p>
      {consentError && <p className="error">{consentError}</p>}
      {!consent ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2 rounded-ds-lg border border-ds-border bg-ds-surface p-4 sm:max-w-md">
          <label className="flex items-center justify-between gap-3 text-sm">
            Allow platform support (ticket visibility)
            <input
              type="checkbox"
              checked={consent.allow_platform_support}
              disabled={consentBusy}
              onChange={() => toggleConsent("allow_platform_support")}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            Allow platform metrics visibility
            <input
              type="checkbox"
              checked={consent.allow_platform_metrics}
              disabled={consentBusy}
              onChange={() => toggleConsent("allow_platform_metrics")}
            />
          </label>
        </div>
      )}

      {orgId === PLATFORM_ORG_ID && (
        <>
          <h2>Admin — onboard org</h2>
          <p className="muted">
            Creates a new tenant, stamps its vertical's policy pack, and creates the org's first admin.
          </p>

          <form onSubmit={handleCreateOrg} className="ingest-form">
            <label>
              Org name
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            </label>
            <label>
              Vertical
              <select value={vertical} onChange={(e) => setVertical(e.target.value as Vertical)}>
                <option value="retail_ecommerce">retail_ecommerce</option>
                <option value="software">software</option>
                <option value="finance">finance</option>
              </select>
            </label>
            <label>
              Admin username
              <input
                value={orgAdminUsername}
                onChange={(e) => setOrgAdminUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Admin password (min 8 characters)
              <input
                type="password"
                value={orgAdminPassword}
                onChange={(e) => setOrgAdminPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label>
              Admin display name
              <input
                value={orgAdminDisplayName}
                onChange={(e) => setOrgAdminDisplayName(e.target.value)}
                required
              />
            </label>
            {orgError && <p className="error">{orgError}</p>}
            <button type="submit" disabled={orgBusy}>
              {orgBusy ? "Creating…" : "Create org"}
            </button>
          </form>

          {orgCreated && (
            <p className="muted">
              Created <code>{orgCreated.org.name}</code> ({orgCreated.org.slug}, {orgCreated.org.vertical}) —{" "}
              {orgCreated.document_ids.length} policy docs stamped. Its admin can log in immediately.
            </p>
          )}
        </>
      )}
    </div>
  );
}
