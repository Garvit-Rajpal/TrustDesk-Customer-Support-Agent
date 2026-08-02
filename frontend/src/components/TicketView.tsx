import { useEffect, useState } from "react";
import {
  api,
  type DraftResult,
  type Order,
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
import { ChatThread } from "../design-system/ChatThread.js";
import { CustomerCard } from "../design-system/CustomerCard.js";
import { OrderCard } from "../design-system/OrderCard.js";

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
  // V3-9 (LLD_v3 §6): only the message produced by an action taken in this
  // component during this session gets the typewriter treatment — history
  // loaded from GET /messages renders instantly.
  const [freshMessageId, setFreshMessageId] = useState<string | null>(null);
  // V4-4 (LLD_v4 §3): the customer's other orders, for the order-history
  // section below the current order's OrderCard.
  const [otherOrders, setOtherOrders] = useState<Order[]>([]);

  function load() {
    api
      .getTicket(ticketId)
      .then((res) => {
        setDetail(res);
        setTriage(res.ticket.triage);
        setTriageRunId(null);
        return api.listCustomerOrders(res.customer.customer_id);
      })
      .then((res) => setOtherOrders(res.orders))
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
    setFreshMessageId(null);
    setOtherOrders([]);
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
      const result = await api.draftReply(ticketId);
      setDraft(result);
      // V3-5 (LLD_v3 §3): draft-reply auto-sends when eligible — the reply
      // is already on the thread, so reload it and let the newest outbound
      // message get the typewriter treatment, same as a manual send.
      if (result.auto_sent) {
        const res = await api.getMessages(ticketId);
        setMessages(res.messages);
        const last = res.messages[res.messages.length - 1];
        if (last) setFreshMessageId(last.message_id);
        await refreshStatus();
      }
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
      const result = await api.sendDraft(draft.draft_id);
      setDraft(null);
      setFreshMessageId(result.message.message_id);
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
        {ticket.human_owned && (
          <span className="ml-2 inline-block rounded-ds-sm bg-status-warning-bg px-2 py-0.5 text-xs font-semibold text-status-warning-fg">
            Human-owned
          </span>
        )}
      </h2>
      <p className="muted">
        {ticket.ticket_id} · {ticket.channel} · {ticket.created_at}
      </p>
      <p>{ticket.body}</p>

      <section className="my-4 h-[420px] rounded-ds-lg border border-ds-border bg-ds-bg p-3">
        {messages.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : (
          <ChatThread
            ticketId={ticketId}
            messages={messages}
            humanOwned={ticket.human_owned}
            disabled={ticket.status === "closed"}
            latestOutboundIsFresh={Boolean(freshMessageId)}
            onMessageSent={(message) => {
              setMessages((prev) => [...prev, message]);
              setFreshMessageId(message.message_id);
              refreshStatus();
            }}
          />
        )}
      </section>

      <details className="mb-4 text-sm">
        <summary className="cursor-pointer text-ds-text-muted">Demo controls</summary>
        <div className="decision-row mt-2">
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
      </details>

      <div className="my-4 grid gap-4 md:grid-cols-2">
        <CustomerCard customer={customer} />
        {order ? <OrderCard order={order} /> : (
          <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-sm text-ds-text-muted shadow-sm">
            No order linked to this ticket.
          </div>
        )}
      </div>

      {otherOrders.filter((o) => o.order_id !== order?.order_id).length > 0 && (
        <details className="my-4 text-sm">
          <summary className="cursor-pointer text-ds-text-muted">
            {customer.name}'s other orders ({otherOrders.filter((o) => o.order_id !== order?.order_id).length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {otherOrders
              .filter((o) => o.order_id !== order?.order_id)
              .map((o) => (
                <OrderCard key={o.order_id} order={o} compact />
              ))}
          </div>
        </details>
      )}

      {error && <p className="error">{error}</p>}

      <div className="actions-row">
        <button disabled={busy} onClick={handleTriage}>
          Run triage
        </button>
        <button disabled={busy || !triage || ticket.human_owned} onClick={handleDraft}>
          Generate draft reply
        </button>
        {ticket.human_owned && (
          <span className="muted">This ticket is human-owned — AI drafting is disabled.</span>
        )}
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
          <h3>
            Draft reply — {draft.resolution_type}
            {draft.auto_sent && (
              <span className="ml-2 inline-block rounded-ds-sm bg-status-success-bg px-2 py-0.5 text-xs font-semibold text-status-success-fg">
                Auto-sent
              </span>
            )}
          </h3>
          <p className="draft-body">{draft.body}</p>
          <p className="muted">Citations: {draft.citations.length > 0 ? draft.citations.join(", ") : "none"}</p>
          <RunStepper ticketId={ticketId} runId={draft.run_id} />
          <TracePanel runId={draft.run_id} />
          <FeedbackControl draftId={draft.draft_id} />
          {!draft.auto_sent && (
            <div className="actions-row">
              <button disabled={busy} onClick={handleSendDraft}>
                Send draft to customer
              </button>
            </div>
          )}

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
