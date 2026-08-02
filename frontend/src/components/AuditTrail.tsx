import { useEffect, useState } from "react";
import { api, type AgentRunSummary } from "../api.js";
import { DataTable, type DataTableColumn } from "../design-system/DataTable.js";
import { StatusBadge } from "../design-system/StatusBadge.js";
import { Modal } from "../design-system/Modal.js";
import { TracePanel } from "./TracePanel.js";

function guardrailSummary(results: AgentRunSummary["guardrail_results"]): string {
  if (results.length === 0) return "—";
  const failed = results.filter((r) => !r.passed).length;
  return failed === 0 ? `${results.length} passed` : `${failed}/${results.length} failed`;
}

function formatOrderTotal(run: AgentRunSummary): string {
  if (!run.order_id || run.order_total == null) return "—";
  return `${run.order_currency ?? ""} ${run.order_total}`.trim();
}

const COLUMNS: DataTableColumn<AgentRunSummary>[] = [
  { key: "created_at", header: "When", render: (r) => new Date(r.created_at).toLocaleString() },
  { key: "run_type", header: "Run type", render: (r) => r.run_type },
  { key: "status", header: "Status", render: (r) => <StatusBadge value={r.status} /> },
  {
    key: "ticket",
    header: "Ticket",
    render: (r) => (r.ticket_id ? `${r.ticket_id} — ${r.ticket_subject ?? ""}` : "—"),
  },
  {
    key: "customer",
    header: "Customer",
    render: (r) => (r.customer_name ? `${r.customer_name} (${r.customer_email})` : "—"),
  },
  {
    key: "order",
    header: "Order",
    render: (r) =>
      r.order_id ? (
        <span>
          {r.order_id} · <StatusBadge value={r.order_status ?? ""} /> · {formatOrderTotal(r)}
        </span>
      ) : (
        "—"
      ),
  },
  { key: "guardrails", header: "Guardrails", render: (r) => guardrailSummary(r.guardrail_results) },
  {
    key: "rag",
    header: "RAG context",
    render: (r) =>
      r.similar_resolutions_count > 0 ? `${r.similar_resolutions_count} used` : "—",
  },
  {
    key: "model",
    header: "Model",
    render: (r) => (r.model_provider ? `${r.model_provider}/${r.model_name ?? "?"}` : "—"),
  },
];

// New (audit trail): a reviewer-facing, org-scoped log of every AI pipeline
// run (triage/draft/tool_recommendation/eval_case) — GET /agent-runs (list),
// joined server-side to each run's ticket/customer/order. Clicking a row
// reuses TracePanel (already built for TicketView's per-run drill-down) in
// a Modal — first real consumer of Modal.tsx, which existed but had no
// caller until now. Read-only: this page makes no writes.
export function AuditTrail() {
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAgentRuns()
      .then((res) => setRuns(res.runs))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load audit trail"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading audit trail…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <p className="muted">
        Every AI pipeline run for this org, most recent first — {runs.length} run{runs.length === 1 ? "" : "s"}.
        Click a row for the full guardrail trace.
      </p>
      {runs.length === 0 ? (
        <p className="muted">No runs yet — triage or draft a ticket to see one here.</p>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={runs}
          rowKey={(r) => r.run_id}
          onRowClick={(r) => setSelectedRunId(r.run_id)}
        />
      )}

      {selectedRunId && (
        <Modal title={selectedRunId} onClose={() => setSelectedRunId(null)} size="lg">
          <TracePanel runId={selectedRunId} />
        </Modal>
      )}
    </div>
  );
}
