import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type DashboardSummary } from "../api.js";
import { MetricTile } from "../design-system/MetricTile.js";

// Mirrors design-system/tokens.css's status palette (LLD_v3 §6) — recharts
// needs literal color values, it can't consume Tailwind classes.
const STATUS_COLORS: Record<string, string> = {
  open: "#64748b",
  in_progress: "#0891b2",
  customer_replied: "#0891b2",
  awaiting_customer: "#d97706",
  resolved: "#16a34a",
  closed: "#94a3b8",
};

function formatPercent(value: number | null): string {
  return value === null ? "no data" : `${(value * 100).toFixed(0)}%`;
}

// V3-9 (LLD_v3 §5/§6, HLD_v3 ADR-17): dashboard home — ticket-count-by-status
// chart, quality metrics, and eval-run summary (org_default only; every other
// org sees an explicit "not configured" state, see GET /dashboard/summary).
export function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDashboardSummary()
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!summary) return <p>Loading…</p>;

  const statusRows = Object.entries(summary.tickets_by_status).map(([status, count]) => ({ status, count }));
  const totalTickets = statusRows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div>
      <h2 className="text-xl font-semibold text-ds-text">Dashboard</h2>
      <p className="muted">A snapshot of your ticket queue and AI quality.</p>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricTile label="Total tickets" value={String(totalTickets)} />
        <MetricTile label="Draft acceptance" value={formatPercent(summary.quality.draft_acceptance_rate)} />
        <MetricTile label="Action approval" value={formatPercent(summary.quality.action_approval_rate)} />
        <MetricTile
          label="Avg rating"
          value={summary.quality.avg_rating === null ? "no data" : `${summary.quality.avg_rating.toFixed(2)}/5`}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-ds-text">Tickets by status</h3>
          {statusRows.length === 0 ? (
            <p className="muted mt-2">No tickets yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusRows} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80}>
                  {statusRows.map((r) => (
                    <Cell key={r.status} fill={STATUS_COLORS[r.status] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-ds-text">Guardrail block rate by category</h3>
          {Object.keys(summary.quality.by_category).length === 0 ? (
            <p className="muted mt-2">No categorized data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={Object.entries(summary.quality.by_category).map(([category, m]) => ({
                  category,
                  rate: m.guardrail_block_rate ?? 0,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
                <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(0)}%`} />
                <Bar dataKey="rate" fill="#0891b2" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ds-text">Latest eval run</h3>
        {summary.eval_summary.available ? (
          <div className="mt-2 flex flex-wrap gap-4">
            {Object.entries(summary.eval_summary.metrics).map(([key, value]) => (
              <MetricTile key={key} label={key.replace(/_/g, " ")} value={formatPercent(value)} />
            ))}
          </div>
        ) : (
          <p className="muted mt-2">
            Eval reporting isn't configured for this org yet — it's only available for the platform demo org today.
          </p>
        )}
      </div>
    </div>
  );
}
