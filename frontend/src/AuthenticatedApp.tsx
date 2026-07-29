import { useState } from "react";
import { setWelcomeSeenAt, type Role } from "./api.js";
import { Queue } from "./components/Queue.js";
import { TicketView } from "./components/TicketView.js";
import { EvalReport } from "./components/EvalReport.js";
import { Documents } from "./components/Documents.js";
import { Admin } from "./components/Admin.js";
import { QualityDashboard } from "./components/QualityDashboard.js";
import { PlatformSupport } from "./components/PlatformSupport.js";
import { Shell, type NavItem } from "./design-system/Shell.js";
import { WelcomeBanner } from "./design-system/WelcomeBanner.js";
import { Dashboard } from "./pages/Dashboard.js";

const PLATFORM_ORG_ID = "org_default";

export interface Session {
  displayName: string;
  role: Role;
  orgId: string;
  orgName: string;
  welcomeSeenAt: string | null;
}

type View =
  | { name: "dashboard" }
  | { name: "queue" }
  | { name: "ticket"; ticketId: string }
  | { name: "eval" }
  | { name: "documents" }
  | { name: "quality" }
  | { name: "admin" }
  | { name: "platform" };

// V3-8 (LLD_v3 §6): the pre-v3 App.tsx content, unchanged in structure
// (plan: "keep the authenticated app's internal view-switching as-is") —
// just extracted so the new root App.tsx can route the public tree (/,
// /signup, /login) to it via /app/*, and to add the first-login welcome
// banner (V3-7).
export function AuthenticatedApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [view, setView] = useState<View>({ name: "dashboard" });
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  const canViewQuality = session.role === "manager" || session.role === "admin";
  // V3-6/V3-9 (LLD_v3 §4, HLD_v3 ADR-16): read-only cross-org view, only
  // meaningful for the platform operator's own org — same guard the backend
  // independently enforces on every /platform/* route.
  const canViewPlatform = session.orgId === PLATFORM_ORG_ID;

  // V2-2/V2-3 (LLD_v2 §8): "sidebar ... items filtered by role" — Quality
  // dashboard is manager+, Admin is admin-only; the backend enforces the
  // real permission checks independently either way.
  const navItems: NavItem[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      active: view.name === "dashboard",
      onClick: () => setView({ name: "dashboard" }),
    },
    {
      key: "queue",
      label: "Ticket queue",
      active: view.name === "queue" || view.name === "ticket",
      onClick: () => setView({ name: "queue" }),
    },
    {
      key: "documents",
      label: "Documents",
      active: view.name === "documents",
      onClick: () => setView({ name: "documents" }),
    },
    {
      key: "eval",
      label: "Eval report",
      active: view.name === "eval",
      onClick: () => setView({ name: "eval" }),
    },
    ...(canViewQuality
      ? [
          {
            key: "quality",
            label: "Quality dashboard",
            active: view.name === "quality",
            onClick: () => setView({ name: "quality" as const }),
          },
        ]
      : []),
    ...(session.role === "admin"
      ? [
          {
            key: "admin",
            label: "Admin",
            active: view.name === "admin",
            onClick: () => setView({ name: "admin" as const }),
          },
        ]
      : []),
    ...(canViewPlatform
      ? [
          {
            key: "platform",
            label: "Platform support",
            active: view.name === "platform",
            onClick: () => setView({ name: "platform" as const }),
          },
        ]
      : []),
  ];

  return (
    <Shell navItems={navItems} displayName={session.displayName} orgName={session.orgName} onLogout={onLogout}>
      {!session.welcomeSeenAt && !welcomeDismissed && (
        <WelcomeBanner
          orgName={session.orgName}
          onDismiss={() => {
            setWelcomeSeenAt(new Date().toISOString());
            setWelcomeDismissed(true);
          }}
        />
      )}
      {view.name === "dashboard" && <Dashboard />}
      {view.name === "queue" && <Queue onSelect={(ticketId) => setView({ name: "ticket", ticketId })} />}
      {view.name === "ticket" && (
        <TicketView ticketId={view.ticketId} onBack={() => setView({ name: "queue" })} role={session.role} />
      )}
      {view.name === "documents" && <Documents role={session.role} />}
      {view.name === "eval" && <EvalReport role={session.role} />}
      {view.name === "quality" && canViewQuality && <QualityDashboard />}
      {view.name === "admin" && session.role === "admin" && <Admin orgId={session.orgId} />}
      {view.name === "platform" && canViewPlatform && <PlatformSupport />}
    </Shell>
  );
}
