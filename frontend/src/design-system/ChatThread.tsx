import { useState } from "react";
import type { TicketMessage } from "../api.js";
import { api } from "../api.js";
import { useTypewriter } from "../hooks/useTypewriter.js";

// V3-4/V3-8 (LLD_v3 §3/§6, HLD_v3 ADR-15/ADR-18): chat-bubble-styled thread.
// The system greeting (author: "system", no draft_id) is styled distinctly
// from a human/AI reply. The compose box calls the human-takeover manual
// reply endpoint directly — once human_owned flips true (backend-driven,
// one-way, invariant #11), AI drafting is permanently blocked for this
// ticket, so the compose box becomes the only way to reply; it stays
// enabled throughout, since a human can always speak in the thread.
function Bubble({ message, typewriter }: { message: TicketMessage; typewriter: boolean }) {
  const isInbound = message.direction === "inbound";
  const isGreeting = message.author === "system" && message.draft_id === null;
  const { display } = useTypewriter(typewriter ? message.body : "");
  const body = typewriter ? display || message.body.slice(0, 1) : message.body;

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[75%] rounded-ds-lg px-4 py-2 text-sm shadow-sm ${
          isInbound
            ? "bg-ds-surface border border-ds-border text-ds-text"
            : isGreeting
              ? "bg-status-info-bg text-status-info-fg"
              : "bg-ds-accent text-ds-accent-contrast"
        }`}
      >
        <div className="whitespace-pre-wrap">{typewriter ? body : message.body}</div>
        <div className={`mt-1 text-[11px] opacity-70`}>
          {isGreeting ? "TrustDesk" : message.author} · {new Date(message.created_at).toLocaleTimeString()}
          {message.draft_id && !isGreeting && " · AI draft"}
        </div>
      </div>
    </div>
  );
}

export function ChatThread({
  ticketId,
  messages,
  humanOwned,
  disabled,
  onMessageSent,
  latestOutboundIsFresh,
}: {
  ticketId: string;
  messages: TicketMessage[];
  humanOwned: boolean;
  // Disabled entirely when the ticket is closed — a closed thread is
  // read-only regardless of human_owned.
  disabled?: boolean;
  onMessageSent: (message: TicketMessage) => void;
  // True only for the message that was just produced this session (e.g. an
  // auto-sent reply right after ticket creation) — older history renders
  // instantly, not replayed with the typewriter effect on every remount.
  latestOutboundIsFresh?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastMessageId = messages.length > 0 ? messages[messages.length - 1]!.message_id : null;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const message = await api.sendManualReply(ticketId, draft.trim());
      setDraft("");
      onMessageSent(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {humanOwned && (
        <div className="mb-2 rounded-ds-sm bg-status-warning-bg px-3 py-1.5 text-xs font-medium text-status-warning-fg">
          A human agent has taken over this ticket — AI drafting is disabled for it.
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-2">
        {messages.map((m) => (
          <Bubble
            key={m.message_id}
            message={m}
            typewriter={Boolean(latestOutboundIsFresh) && m.message_id === lastMessageId && m.direction === "outbound"}
          />
        ))}
      </div>
      <form onSubmit={handleSend} className="mt-3 flex gap-2 border-t border-ds-border pt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? "This ticket is closed" : "Type a reply…"}
          disabled={disabled || sending}
          className="flex-1 rounded-ds-md border border-ds-border px-3 py-2 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || sending || !draft.trim()}
          className="rounded-ds-md bg-ds-accent px-4 py-2 text-sm font-medium text-ds-accent-contrast disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-status-danger-fg">{error}</p>}
    </div>
  );
}
