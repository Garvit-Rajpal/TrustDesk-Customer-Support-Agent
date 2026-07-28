import { useState } from "react";
import { clearToken, getToken } from "./api.js";
import { Login } from "./components/Login.js";
import { Queue } from "./components/Queue.js";
import { TicketView } from "./components/TicketView.js";
import { EvalReport } from "./components/EvalReport.js";
import { Documents } from "./components/Documents.js";
import { Shell, type NavItem } from "./design-system/Shell.js";

type View =
  | { name: "queue" }
  | { name: "ticket"; ticketId: string }
  | { name: "eval" }
  | { name: "documents" };

export default function App() {
  const [displayName, setDisplayName] = useState<string | null>(() => (getToken() ? "agent" : null));
  const [view, setView] = useState<View>({ name: "queue" });

  if (!displayName) {
    return <Login onLogin={setDisplayName} />;
  }

  function handleLogout() {
    clearToken();
    setDisplayName(null);
    setView({ name: "queue" });
  }

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
  ];

  return (
    <Shell navItems={navItems} displayName={displayName} onLogout={handleLogout}>
      {view.name === "queue" && <Queue onSelect={(ticketId) => setView({ name: "ticket", ticketId })} />}
      {view.name === "ticket" && (
        <TicketView ticketId={view.ticketId} onBack={() => setView({ name: "queue" })} />
      )}
      {view.name === "documents" && <Documents />}
      {view.name === "eval" && <EvalReport />}
    </Shell>
  );
}
