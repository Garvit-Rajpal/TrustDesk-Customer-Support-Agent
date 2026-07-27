import { useState } from "react";
import { api, type RecommendedAction, type ToolActionResult } from "../api.js";

// One recommended action -> its own request/approve/reject/execute
// lifecycle. The payload is a hand-editable JSON textarea rather than a
// per-tool generated form — the frontend doesn't have the tool catalog's
// required_fields loaded, and HLD explicitly allows "JSON panels" here.
export function ActionPanel({
  ticketId,
  orderId,
  action,
}: {
  ticketId: string;
  orderId: string | null;
  action: RecommendedAction;
}) {
  const [payloadText, setPayloadText] = useState(() =>
    JSON.stringify(
      {
        ...(orderId ? { order_id: orderId } : {}),
        reason: action.reason,
        idempotency_key: `${ticketId}-${action.tool_name}-1`,
      },
      null,
      2
    )
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
