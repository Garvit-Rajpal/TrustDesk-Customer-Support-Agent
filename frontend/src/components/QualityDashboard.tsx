import { useEffect, useState } from "react";
import { api, type QualityReport } from "../api.js";
import { DataTable, type DataTableColumn } from "../design-system/DataTable.js";

const METRIC_LABELS: Record<string, string> = {
  draft_acceptance_rate: "Draft acceptance rate",
  action_approval_rate: "Action approval rate",
  avg_rating: "Avg rating",
  guardrail_block_rate: "Guardrail block rate",
};

function formatMetric(key: string, value: number | null): string {
  if (value === null) return "no data";
  return key === "avg_rating" ? `${value.toFixed(2)}/5` : `${(value * 100).toFixed(0)}%`;
}

interface CategoryRow {
  category: string;
  draft_acceptance_rate: number | null;
  action_approval_rate: number | null;
  avg_rating: number | null;
  guardrail_block_rate: number | null;
}

const CATEGORY_COLUMNS: DataTableColumn<CategoryRow>[] = [
  { key: "category", header: "Category", render: (r) => r.category },
  { key: "acceptance", header: "Draft acceptance", render: (r) => formatMetric("draft_acceptance_rate", r.draft_acceptance_rate) },
  { key: "approval", header: "Action approval", render: (r) => formatMetric("action_approval_rate", r.action_approval_rate) },
  { key: "rating", header: "Avg rating", render: (r) => formatMetric("avg_rating", r.avg_rating) },
  { key: "blocked", header: "Guardrail blocked", render: (r) => formatMetric("guardrail_block_rate", r.guardrail_block_rate) },
];

// V2-3 (LLD_v2 §4/§8): "quality dashboard page", manager+ only (App.tsx
// gates the nav item; the backend independently enforces
// requirePermission("metrics:view")).
export function QualityDashboard() {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAgentQuality()
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load metrics"));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!report) return <p>Loading…</p>;

  const rows: CategoryRow[] = Object.entries(report.by_category).map(([category, m]) => ({
    category,
    ...m,
  }));

  return (
    <div>
      <h2>Quality dashboard</h2>
      <p className="muted">Computed from feedback, tool-action approvals, and agent runs.</p>

      <table className="kv-table">
        <tbody>
          {(Object.keys(METRIC_LABELS) as (keyof typeof METRIC_LABELS)[]).map((key) => (
            <tr key={key}>
              <td>{METRIC_LABELS[key]}</td>
              <td>{formatMetric(key, report[key as keyof QualityReport] as number | null)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>By category</h3>
      {rows.length === 0 ? (
        <p className="muted">No categorized data yet.</p>
      ) : (
        <DataTable columns={CATEGORY_COLUMNS} rows={rows} rowKey={(r) => r.category} />
      )}
    </div>
  );
}
