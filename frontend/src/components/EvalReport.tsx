import { useState } from "react";
import { api, type EvalReport as EvalReportData, type Role } from "../api.js";
import { EvalRunStepper } from "./EvalRunStepper.js";

const METRIC_LABELS: Record<string, string> = {
  triage_accuracy: "Triage accuracy",
  citation_coverage: "Citation coverage",
  unsafe_action_block_rate: "Unsafe action block rate",
  escalation_accuracy: "Escalation accuracy",
};

export function EvalReport({ role }: { role: Role }) {
  const [report, setReport] = useState<EvalReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // V4-8 (LLD_v4 §4): minted via POST /eval-runs/start so EvalRunStepper
  // can subscribe before the run itself starts.
  const [runningEvalRunId, setRunningEvalRunId] = useState<string | null>(null);

  async function handleRun() {
    setError(null);
    setBusy(true);
    setReport(null);
    try {
      const { eval_run_id } = await api.startEvalRun();
      setRunningEvalRunId(eval_run_id);
      setReport(await api.runEval(undefined, eval_run_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eval run failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Eval report</h2>
      <p className="muted">Runs every case in data/eval_cases.jsonl through the live triage + draft pipeline.</p>
      {/* V2-2 (LLD_v2 §3): running the eval set is admin-only. */}
      {role === "admin" ? (
        <button disabled={busy} onClick={handleRun}>
          {busy ? "Running…" : "Run all eval cases"}
        </button>
      ) : (
        <p className="muted">Only admins can trigger an eval run.</p>
      )}
      {error && <p className="error">{error}</p>}

      {busy && (
        <div className="my-4">
          <EvalRunStepper evalRunId={runningEvalRunId} />
        </div>
      )}

      {report && (
        <>
          <p className="muted">
            {report.eval_run_id} · {report.total_cases} cases
          </p>
          <table className="kv-table">
            <tbody>
              {Object.entries(report.metrics).map(([key, value]) => (
                <tr key={key}>
                  <td>{METRIC_LABELS[key] ?? key}</td>
                  <td>{(value * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="queue-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Ticket</th>
                <th>Triage</th>
                <th>Citations</th>
                <th>Safe actions</th>
                <th>Escalation</th>
              </tr>
            </thead>
            <tbody>
              {report.case_results.map((r) => (
                <tr key={r.case_id}>
                  <td>{r.case_id}</td>
                  <td>{r.ticket_id}</td>
                  <td>{r.triage_accuracy ? "✓" : "✗"}</td>
                  <td>{r.citation_coverage ? "✓" : "✗"}</td>
                  <td>{r.unsafe_action_block_rate ? "✓" : "✗"}</td>
                  <td>{r.escalation_accuracy ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
