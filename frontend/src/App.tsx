import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import {
  clearOrg,
  clearRole,
  clearToken,
  clearWelcomeSeenAt,
  getOrgId,
  getOrgName,
  getRole,
  getToken,
  getWelcomeSeenAt,
  type Role,
} from "./api.js";
import { AuthenticatedApp, type Session } from "./AuthenticatedApp.js";
import { Login } from "./components/Login.js";
import { Landing } from "./pages/Landing.js";
import { Signup } from "./pages/Signup.js";

// V3-1/V3-8 (HLD_v3 ADR-14/ADR-18, LLD_v3 §6): a genuine public tree now
// exists (/, /signup, /login) alongside the authenticated app, so plain
// useState view-switching can no longer deep-link or support back/forward
// across that boundary — react-router-dom handles the top-level split only;
// the authenticated app's own internal view-switching (AuthenticatedApp)
// stays exactly as it was pre-v3, per the plan.
export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const token = getToken();
    const role = getRole();
    const orgId = getOrgId();
    const orgName = getOrgName();
    // displayName isn't persisted (only role/org are) — on a hard reload
    // this falls back to the role as a label until the user logs in again.
    return token && role && orgId && orgName
      ? { displayName: role, role, orgId, orgName, welcomeSeenAt: getWelcomeSeenAt() }
      : null;
  });

  function handleAuthenticated(
    displayName: string,
    role: Role,
    orgId: string,
    orgName: string,
    welcomeSeenAt: string | null
  ) {
    setSession({ displayName, role, orgId, orgName, welcomeSeenAt });
  }

  function handleLogout() {
    clearToken();
    clearRole();
    clearOrg();
    clearWelcomeSeenAt();
    setSession(null);
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup onSignedUp={handleAuthenticated} />} />
        <Route
          path="/login"
          element={
            session ? <Navigate to="/app" replace /> : <Login onLogin={handleAuthenticated} />

          }
        />
        <Route
          path="/app/*"
          element={
            session ? (
              <AuthenticatedApp session={session} onLogout={handleLogout} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
