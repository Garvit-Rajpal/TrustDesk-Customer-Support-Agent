import { useState } from "react";
import { clearToken, getToken } from "./api.js";
import { Login } from "./components/Login.js";
import { Queue } from "./components/Queue.js";
import { TicketView } from "./components/TicketView.js";
import { EvalReport } from "./components/EvalReport.js";
import { Documents } from "./components/Documents.js";

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>TrustDesk</h1>
        <nav>
          <button className="link-button" onClick={() => setView({ name: "queue" })}>
            Ticket queue
          </button>
          <button className="link-button" onClick={() => setView({ name: "documents" })}>
            Documents
          </button>
          <button className="link-button" onClick={() => setView({ name: "eval" })}>
            Eval report
          </button>
        </nav>
        <div className="header-right">
          <span className="muted">{displayName}</span>
          <button className="link-button" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main>
        {view.name === "queue" && (
          <Queue onSelect={(ticketId) => setView({ name: "ticket", ticketId })} />
        )}
        {view.name === "ticket" && (
          <TicketView ticketId={view.ticketId} onBack={() => setView({ name: "queue" })} />
        )}
        {view.name === "documents" && <Documents />}
        {view.name === "eval" && <EvalReport />}
      </main>
    </div>
  );
}
