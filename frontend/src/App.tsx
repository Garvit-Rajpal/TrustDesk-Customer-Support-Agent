import { useState } from "react";
import { clearRole, clearToken, getRole, getToken, type Role } from "./api.js";
import { Login } from "./components/Login.js";
import { Queue } from "./components/Queue.js";
import { TicketView } from "./components/TicketView.js";
import { EvalReport } from "./components/EvalReport.js";
import { Documents } from "./components/Documents.js";
import { Admin } from "./components/Admin.js";
import { QualityDashboard } from "./components/QualityDashboard.js";
import { Shell, type NavItem } from "./design-system/Shell.js";

type View =
  | { name: "queue" }
  | { name: "ticket"; ticketId: string }
  | { name: "eval" }
  | { name: "documents" }
  | { name: "quality" }
  | { name: "admin" };

export default function App() {
  const [session, setSession] = useState<{ displayName: string; role: Role } | null>(() => {
    const token = getToken();
    const role = getRole();
    return token && role ? { displayName: "agent", role } : null;
  });
  const [view, setView] = useState<View>({ name: "queue" });

  if (!session) {
    return <Login onLogin={(displayName, role) => setSession({ displayName, role })} />;
  }

  function handleLogout() {
    clearToken();
    clearRole();
    setSession(null);
    setView({ name: "queue" });
  }

  const canViewQuality = session.role === "manager" || session.role === "admin";

  // V2-2/V2-3 (LLD_v2 §8): "sidebar ... items filtered by role" — Quality
  // dashboard is manager+, Admin is admin-only; the backend enforces the
  // real permission checks independently either way.
  const navItems: NavItem[] = [
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
  ];

  return (
    <Shell navItems={navItems} displayName={session.displayName} onLogout={handleLogout}>
      {view.name === "queue" && <Queue onSelect={(ticketId) => setView({ name: "ticket", ticketId })} />}
      {view.name === "ticket" && (
        <TicketView ticketId={view.ticketId} onBack={() => setView({ name: "queue" })} role={session.role} />
      )}
      {view.name === "documents" && <Documents role={session.role} />}
      {view.name === "eval" && <EvalReport role={session.role} />}
      {view.name === "quality" && canViewQuality && <QualityDashboard />}
      {view.name === "admin" && session.role === "admin" && <Admin />}
    </Shell>
  );
}
