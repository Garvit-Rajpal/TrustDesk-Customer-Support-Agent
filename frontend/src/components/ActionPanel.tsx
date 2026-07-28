import { useState } from "react";
import { api, type RecommendedAction, type ToolActionResult } from "../api.js";

// Best-effort per-tool payload pre-fill from data already on screen
// (ticket/order/customer). This does NOT replace the tool catalog's
// required_fields validation — it's a convenience default in an otherwise
// hand-editable JSON textarea (HLD explicitly allows "JSON panels" here,
// not a generated form per tool). Fields this can't infer (e.g. `queue`,
// coupon `amount`) get a placeholder the agent is expected to review.
function defaultPayload(
  toolName: string,
  ticketId: string,
  reason: string,
  order: Record<string, unknown> | null,
  customer: Record<string, unknown> | null
): Record<string, unknown> {
  const base = { reason, idempotency_key: `${ticketId}-${toolName}-1` };
  const items = (order?.items as { sku?: string }[] | undefined) ?? [];

  switch (toolName) {
    case "create_replacement_order":
      return { ...base, order_id: order?.order_id, sku: items[0]?.sku ?? "" };
    case "start_refund_review":
      return { ...base, order_id: order?.order_id, amount: order?.total ?? 0 };
    case "issue_coupon":
      return { ...base, customer_id: customer?.customer_id, amount: 500 };
    case "open_carrier_investigation":
      return { ...base, order_id: order?.order_id, tracking_number: order?.tracking_number ?? "" };
    case "escalate_to_human":
      return { ...base, ticket_id: ticketId, queue: "specialist_review" };
    case "lock_account":
      return { ...base, customer_id: customer?.customer_id };
    default:
      return { ...base, ...(order?.order_id ? { order_id: order.order_id } : {}) };
  }
}

export function ActionPanel({
  ticketId,
  order,
  customer,
  action,
}: {
  ticketId: string;
  order: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
  action: RecommendedAction;
}) {
  const [payloadText, setPayloadText] = useState(() =>
    JSON.stringify(defaultPayload(action.tool_name, ticketId, action.reason, order, customer), null, 2)
  );
  const [result, setResult] = useState<ToolActionResult | null>(null);
  const [reason, setReason] = useState("Reviewed and confirmed.");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<ToolActionResult>) {
    setError(null);
    setBusy(true);
    try {
      setResult(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function handleRequest() {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setError("Payload is not valid JSON");
      return;
    }
    run(() => api.requestAction({ ticket_id: ticketId, tool_name: action.tool_name, payload }));
  }

  return (
    <div className="action-panel">
      <h4>
        {action.tool_name}{" "}
        {action.requires_human_approval && <span className="badge">requires approval</span>}
      </h4>
      <p className="muted">{action.reason}</p>

      {!result && (
        <>
          <textarea
            className="payload-editor"
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            rows={5}
          />
          <button disabled={busy} onClick={handleRequest}>
            Request action
          </button>
        </>
      )}

      {result && (
        <div className="action-status">
          <p>
            Status: <strong>{result.status}</strong>
            {result.replayed && <span className="badge">replayed</span>}
          </p>

          {result.status === "approval_required" && (
            <div className="decision-row">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
              <button disabled={busy} onClick={() => run(() => api.approveAction(result.action_id, reason))}>
                Approve
              </button>
              <button disabled={busy} onClick={() => run(() => api.rejectAction(result.action_id, reason))}>
                Reject
              </button>
            </div>
          )}

          {result.status === "approved" && (
            <button disabled={busy} onClick={() => run(() => api.executeAction(result.action_id))}>
              Execute
            </button>
          )}

          {(result.status === "executed" || result.status === "failed") && result.execution_result != null && (
            <pre className="json-panel">{JSON.stringify(result.execution_result, null, 2)}</pre>
          )}

          {result.status === "rejected" && <p className="muted">Rejected — terminal, no auto-retry.</p>}
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
