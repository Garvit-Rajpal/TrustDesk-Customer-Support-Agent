import { useEffect, useState } from "react";
import { api, type DraftResult, type TicketDetail, type TriageResult } from "../api.js";
import { ActionPanel } from "./ActionPanel.js";

export function TicketView({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .getTicket(ticketId)
      .then((res) => {
        setDetail(res);
        setTriage(res.ticket.triage ? { ...res.ticket.triage, ticket_id: ticketId, run_id: "" } : null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load ticket"));
  }

  useEffect(() => {
    setDetail(null);
    setTriage(null);
    setDraft(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function handleTriage() {
    setError(null);
    setBusy(true);
    try {
      setTriage(await api.triage(ticketId));
      setDraft(null);
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

  if (!detail) return <p>Loading…</p>;

  const { ticket, customer, order } = detail;
  const orderId = ticket.order_id;

  return (
    <div>
      <button onClick={onBack} className="link-button">
        ← Back to queue
      </button>
      <h2>{ticket.subject}</h2>
      <p className="muted">
        {ticket.ticket_id} · {ticket.channel} · {ticket.created_at}
      </p>
      <p>{ticket.body}</p>

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
        </section>
      )}

      {draft && (
        <section>
          <h3>Draft reply — {draft.resolution_type}</h3>
          <p className="draft-body">{draft.body}</p>
          <p className="muted">Citations: {draft.citations.length > 0 ? draft.citations.join(", ") : "none"}</p>

          {draft.recommended_actions.length === 0 && <p className="muted">No recommended actions.</p>}
          {draft.recommended_actions.map((action) => (
            <ActionPanel
              key={action.tool_name}
              ticketId={ticketId}
              orderId={orderId}
              action={action}
            />
          ))}
        </section>
      )}
    </div>
  );
}
