import { useState } from "react";
import { Navigate } from "react-router-dom";
import { clearCustomerSession, getCustomerToken } from "../api.js";
import { usePortalSocket } from "./usePortalSocket.js";
import { GradientBlobBackground } from "../design-system/GradientBlobBackground.js";

// W17 (LLD_v4 §7): reuses ChatThread.tsx's bubble-rendering concept as a
// simpler, portal-scoped component — no agent-facing controls (no
// simulate-inbound, no draft/approve buttons, nothing that assumes an
// authenticated agent session).
// W26 (LLD_v5 §7, HLD_v5 ADR-28): visual pass — GradientBlobBackground behind
// a translucent/backdrop-blur shell, scale-in on each new bubble mount.
function Bubble({ body, author, direction, createdAt }: { body: string; author: string; direction: "inbound" | "outbound"; createdAt: string }) {
  const isMine = direction === "inbound";
  return (
    <div className={`flex animate-scale-in ${isMine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-ds-lg px-4 py-2 text-sm shadow-sm ${
          isMine ? "bg-ds-accent text-ds-accent-contrast" : "bg-ds-surface border border-ds-border text-ds-text"
        }`}
      >
        <div className="whitespace-pre-wrap">{body}</div>
        <div className="mt-1 text-[11px] opacity-70">
          {isMine ? "You" : author === "system" ? "TrustDesk" : "Support"} ·{" "}
          {new Date(createdAt).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

export function PortalChat() {
  const [customerToken] = useState(getCustomerToken);
  const { messages, statusText, connected, send } = usePortalSocket(customerToken);
  const [draft, setDraft] = useState("");

  // Not verified (no /portal/verify session) — bounce back to the form
  // instead of connecting a WS with no token at all.
  if (!customerToken) {
    return <Navigate to="/portal/verify" replace />;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    send(draft.trim());
    setDraft("");
  }

  function handleStartOver() {
    clearCustomerSession();
    window.location.assign("/portal/verify");
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-ds-bg">
      <GradientBlobBackground variant="portal" blobCount={1} />

      <header className="relative flex items-center justify-between border-b border-ds-border bg-ds-surface/90 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-sm font-bold text-ds-text">Support chat</h1>
          <p className="text-xs text-ds-text-muted">{connected ? "Connected" : "Reconnecting…"}</p>
        </div>
        <button
          onClick={handleStartOver}
          className="border-none bg-transparent text-xs text-ds-text-muted underline"
        >
          Start over
        </button>
      </header>

      <div className="relative mx-auto flex w-full max-w-2xl flex-1 flex-col animate-fade-in-up p-4">
        <div className="flex-1 space-y-3 overflow-y-auto">
          {messages.map((m) => (
            <Bubble key={m.message_id} body={m.body} author={m.author} direction={m.direction} createdAt={m.created_at} />
          ))}
          {statusText && (
            <div className="animate-scale-in rounded-ds-sm bg-status-info-bg px-3 py-1.5 text-xs font-medium text-status-info-fg">
              {statusText}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-3 flex gap-2 border-t border-ds-border pt-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded-ds-md border border-ds-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ds-accent/40"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-medium text-ds-accent-contrast disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
