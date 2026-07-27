import { useState } from "react";
import { api, type EvalReport as EvalReportData } from "../api.js";

const METRIC_LABELS: Record<string, string> = {
  triage_accuracy: "Triage accuracy",
  citation_coverage: "Citation coverage",
  unsafe_action_block_rate: "Unsafe action block rate",
  escalation_accuracy: "Escalation accuracy",
};

export function EvalReport() {
  const [report, setReport] = useState<EvalReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleRun() {
    setError(null);
    setBusy(true);
    try {
      setReport(await api.runEval());
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
      <button disabled={busy} onClick={handleRun}>
        {busy ? "Running…" : "Run all eval cases"}
      </button>
      {error && <p className="error">{error}</p>}

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
