import { useEffect, useState } from "react";
import { api, type AgentRunTrace, type GuardrailCheckResult } from "../api.js";

const LAYER_LABELS: Record<string, string> = {
  input_scan: "L1 · Input scan",
  prompt_structure: "L2 · Prompt structure",
  output_scan: "L3 · Output scan",
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  completed: { label: "Completed", className: "status-ok" },
  guardrail_blocked: { label: "Guardrail blocked — model output discarded", className: "status-blocked" },
  failed: { label: "Failed", className: "status-failed" },
};

function groupByLayer(results: GuardrailCheckResult[]): [string, GuardrailCheckResult[]][] {
  const groups = new Map<string, GuardrailCheckResult[]>();
  for (const r of results) {
    if (!groups.has(r.layer)) groups.set(r.layer, []);
    groups.get(r.layer)!.push(r);
  }
  return Array.from(groups.entries());
}

// Auto-loads and displays the full agent_run trace for one triage/draft
// call: which guardrail checks ran and whether they passed, retrieved doc
// IDs, and — critically — the model's ORIGINAL output when a guardrail
// discarded it (HLD invariant #5). Without this, "resolution_type:
// escalated" looks identical whether the model correctly decided to
// escalate or was blocked trying something unsafe; this is what tells
// them apart.
export function TracePanel({ runId }: { runId: string | null | undefined }) {
  const [trace, setTrace] = useState<AgentRunTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setTrace(null);
    setError(null);
    setExpanded(false);
    if (!runId) return;
    api
      .getAgentRun(runId)
      .then((t) => {
        setTrace(t);
        // Auto-expand when a guardrail actually intervened — that's the
        // one case where the detail matters without the agent asking for it.
        if (t.status === "guardrail_blocked") setExpanded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load trace"));
  }, [runId]);

  if (!runId) {
    return <p className="muted">No trace available — re-run this step to generate one.</p>;
  }
  if (error) return <p className="error">{error}</p>;
  if (!trace) return <p className="muted">Loading trace…</p>;

  const status = STATUS_LABELS[trace.status] ?? { label: trace.status, className: "" };

  return (
    <div className="trace-panel">
      <div className="trace-header">
        <span className={`status-badge ${status.className}`}>{status.label}</span>
        <span className="muted">
          {trace.run_id} · {trace.model_provider ?? "mock"}/{trace.model_name ?? "?"}
          {trace.latency_ms != null && ` · ${trace.latency_ms}ms`}
        </span>
        <button className="link-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Hide" : "Show"} trace details
        </button>
      </div>

      {trace.status === "guardrail_blocked" && (
        <p className="warning-note">
          ⚠️ The model's proposed output failed a guardrail check and was discarded. The
          customer-facing response above is a deterministic safe template, not what the
          model generated. See the failed check below and the original output.
        </p>
      )}

      {expanded && (
        <>
          {trace.retrieved_doc_ids.length > 0 && (
            <div className="trace-section">
              <h5>Retrieved documents</h5>
              <div className="chip-row">
                {trace.retrieved_doc_ids.map((id) => (
                  <span key={id} className="chip">
                    {id}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="trace-section">
            <h5>Guardrail checks</h5>
            {groupByLayer(trace.guardrail_results).map(([layer, results]) => (
              <div key={layer} className="guardrail-layer">
                <p className="layer-label">{LAYER_LABELS[layer] ?? layer}</p>
                <ul className="guardrail-list">
                  {results.map((r, i) => (
                    <li key={i} className={r.passed ? "check-pass" : "check-fail"}>
                      <span>{r.passed ? "✓" : "✗"}</span> <code>{r.check}</code>
                      {r.detail && <span className="muted"> — {r.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {trace.rejected_output != null && (
            <div className="trace-section">
              <button className="link-button" onClick={() => setShowRejected((v) => !v)}>
                {showRejected ? "Hide" : "Show"} discarded model output (
                {typeof trace.rejected_output === "string" ? "raw text" : "JSON"})
              </button>
              {showRejected && (
                <pre className="json-panel danger-panel">
                  {typeof trace.rejected_output === "string"
                    ? trace.rejected_output
                    : JSON.stringify(trace.rejected_output, null, 2)}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
