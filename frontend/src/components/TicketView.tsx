import { useEffect, useState } from "react";
import {
  api,
  type DraftResult,
  type Role,
  type TicketDetail,
  type TicketMessage,
  type TriageResult,
} from "../api.js";
import { ActionPanel } from "./ActionPanel.js";
import { TracePanel } from "./TracePanel.js";
import { RunStepper } from "./RunStepper.js";
import { FeedbackControl } from "./FeedbackControl.js";
import { StatusBadge } from "../design-system/StatusBadge.js";

type TriageDisplay = Pick<
  TriageResult,
  "category" | "priority" | "sentiment" | "should_escalate" | "reason_summary"
>;

export function TicketView({
  ticketId,
  onBack,
  role,
}: {
  ticketId: string;
  onBack: () => void;
  role: Role;
}) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [triage, setTriage] = useState<TriageDisplay | null>(null);
  // Separate from `triage` because a triage loaded from the stored ticket
  // (page load) has no run_id — only a freshly-run triage in this session
  // does, and TracePanel needs to tell "no trace yet" apart from "loading".
  const [triageRunId, setTriageRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [replyBody, setReplyBody] = useState("");

  function load() {
    api
      .getTicket(ticketId)
      .then((res) => {
        setDetail(res);
        setTriage(res.ticket.triage);
        setTriageRunId(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ticket"));
    loadMessages();
  }

  function loadMessages() {
    api
      .getMessages(ticketId)
      .then((res) => setMessages(res.messages))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load thread"));
  }

  useEffect(() => {
    setDetail(null);
    setTriage(null);
    setTriageRunId(null);
    setDraft(null);
    setMessages([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // Re-fetches just the ticket (status can change from triage's
  // open/customer_replied -> in_progress auto-advance, LLD_v2 §5) without
  // disturbing the triage/draft/messages state already on screen.
  async function refreshStatus() {
    const res = await api.getTicket(ticketId);
    setDetail(res);
  }

  async function handleTriage() {
    setError(null);
    setBusy(true);
    try {
      const result = await api.triage(ticketId);
      setTriage(result);
      setTriageRunId(result.run_id);
      setDraft(null);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Triage failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDraft() {
    setError(null);
    setBusy(true);
    try {
      setDraft(await api.draftReply(ticketId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendDraft() {
    if (!draft) return;
    setError(null);
    setBusy(true);
    try {
      await api.sendDraft(draft.draft_id);
      setDraft(null);
      await refreshStatus();
      loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSimulateInbound() {
    if (!replyBody.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await api.simulateInbound(ticketId, replyBody);
      setReplyBody("");
      await refreshStatus();
      loadMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulated reply failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleResolve() {
    setError(null);
    setBusy(true);
    try {
      await api.resolveTicket(ticketId);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    setError(null);
    setBusy(true);
    try {
      await api.closeTicket(ticketId);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Close failed");
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return <p>Loading…</p>;

  const { ticket, customer, order } = detail;

  return (
    <div>
      <button onClick={onBack} className="link-button">
        ← Back to queue
      </button>
      <h2>
        {ticket.subject} <StatusBadge value={ticket.status} />
      </h2>
      <p className="muted">
        {ticket.ticket_id} · {ticket.channel} · {ticket.created_at}
      </p>
      <p>{ticket.body}</p>

      <section className="thread-panel">
        <h4>Thread</h4>
        {messages.length === 0 && <p className="muted">Loading…</p>}
        <ul className="thread-list">
          {messages.map((m) => (
            <li key={m.message_id} className={`thread-message thread-message--${m.direction}`}>
              <div className="thread-message-meta">
                {m.direction} · {m.author} · {m.created_at}
              </div>
              <div className="thread-message-body">{m.body}</div>
            </li>
          ))}
        </ul>

        <div className="decision-row">
          <input
            placeholder="Simulate a customer reply…"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            disabled={busy}
          />
          <button disabled={busy || !replyBody.trim()} onClick={handleSimulateInbound}>
            Simulate inbound
          </button>
        </div>

        <div className="actions-row">
          <button disabled={busy} onClick={handleResolve}>
            Resolve
          </button>
          <button disabled={busy} onClick={handleClose}>
            Close
          </button>
        </div>
      </section>

      <div className="context-grid">
        <div>
          <h4>Customer</h4>
          <pre className="json-panel">{JSON.stringify(customer, null, 2)}</pre>
        </div>
        <div>
          <h4>Order</h4>
          <pre className="json-panel">{JSON.stringify(order, null, 2)}</pre>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="actions-row">
        <button disabled={busy} onClick={handleTriage}>
          Run triage
        </button>
        <button disabled={busy || !triage} onClick={handleDraft}>
          Generate draft reply
        </button>
      </div>

      {triage && (
        <section>
          <h3>Triage</h3>
          <table className="kv-table">
            <tbody>
              <tr>
                <td>Category</td>
                <td>{triage.category}</td>
              </tr>
              <tr>
                <td>Priority</td>
                <td>{triage.priority}</td>
              </tr>
              <tr>
                <td>Sentiment</td>
                <td>{triage.sentiment}</td>
              </tr>
              <tr>
                <td>Escalate?</td>
                <td>{triage.should_escalate ? "yes" : "no"}</td>
              </tr>
              <tr>
                <td>Reason</td>
                <td>{triage.reason_summary}</td>
              </tr>
            </tbody>
          </table>
          <RunStepper ticketId={ticketId} runId={triageRunId} />
          <TracePanel runId={triageRunId} />
        </section>
      )}

      {draft && (
        <section>
          <h3>Draft reply — {draft.resolution_type}</h3>
          <p className="draft-body">{draft.body}</p>
          <p className="muted">Citations: {draft.citations.length > 0 ? draft.citations.join(", ") : "none"}</p>
          <RunStepper ticketId={ticketId} runId={draft.run_id} />
          <TracePanel runId={draft.run_id} />
          <FeedbackControl draftId={draft.draft_id} />
          <div className="actions-row">
            <button disabled={busy} onClick={handleSendDraft}>
              Send draft to customer
            </button>
          </div>

          {draft.recommended_actions.length === 0 && <p className="muted">No recommended actions.</p>}
          {draft.recommended_actions.map((action) => (
            <ActionPanel
              key={action.tool_name}
              ticketId={ticketId}
              order={order}
              customer={customer}
              action={action}
              role={role}
            />
          ))}
        </section>
      )}
    </div>
  );
}
