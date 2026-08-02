import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type DashboardSummary } from "../api.js";
import { MetricTile } from "../design-system/MetricTile.js";

// W18 (HLD_v4 ADR-24, `dataviz` skill): the app's own design system
// (tokens.css) has no categorical ramp — only an accent color and a
// 5-tone status scale that isn't safe to reuse here as-is (StatusBadge
// collapses several ticket statuses onto the same tone, e.g. open/
// in_progress both read "info"; a 6-slice pie needs six *distinct* hues,
// not four). This is the dataviz skill's validated 6-slot default
// categorical order (`references/palette.md`) — light mode only, since
// this app has no dark theme. `node scripts/validate_palette.js
// "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300" --mode light` passes
// every check except contrast-vs-surface on 3 of the 6 (WARN, not FAIL) —
// the required "relief" is the always-on <Legend/> below, so identity
// never depends on a low-contrast hue alone.
//
// STATUS_ORDER fixes both the pie's slice order (so the adjacency this
// palette was validated against is the adjacency actually rendered — the
// backend's tickets_by_status key order isn't guaranteed) and the legend's
// reading order, lifecycle-first.
const STATUS_ORDER = ["open", "in_progress", "customer_replied", "awaiting_customer", "resolved", "closed"] as const;
const STATUS_COLORS: Record<string, string> = {
  open: "#2a78d6",
  in_progress: "#eb6834",
  customer_replied: "#1baf7a",
  awaiting_customer: "#eda100",
  resolved: "#e87ba4",
  closed: "#008300",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  customer_replied: "Customer replied",
  awaiting_customer: "Awaiting customer",
  resolved: "Resolved",
  closed: "Closed",
};

// Single-series magnitude bar — one hue, the app's own accent, per the
// "sequential = one hue" rule (a distinct categorical palette would be
// wrong here: there's only one series, not several identities).
const GUARDRAIL_RATE_COLOR = "#2563eb"; // ds-accent

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
  if (!summary) return <p className="muted">Loading…</p>;

  const statusRows = STATUS_ORDER.filter((status) => summary.tickets_by_status[status]).map((status) => ({
    status,
    count: summary.tickets_by_status[status]!,
  }));
  const totalTickets = statusRows.reduce((sum, r) => sum + r.count, 0);

  const kpiTiles = [
    { label: "Total tickets", value: String(totalTickets) },
    { label: "Draft acceptance", value: formatPercent(summary.quality.draft_acceptance_rate) },
    { label: "Action approval", value: formatPercent(summary.quality.action_approval_rate) },
    {
      label: "Avg rating",
      value: summary.quality.avg_rating === null ? "no data" : `${summary.quality.avg_rating.toFixed(2)}/5`,
    },
  ];

  return (
    <div>
      <h2 className="text-xl font-semibold text-ds-text">Dashboard</h2>
      <p className="muted mt-1">A snapshot of your ticket queue and AI quality.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {kpiTiles.map((tile, i) => (
          <MetricTile key={tile.label} label={tile.label} value={tile.value} style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="animate-fade-in rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-ds-text">Tickets by status</h3>
          {statusRows.length === 0 ? (
            <p className="muted mt-2">No tickets yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusRows} dataKey="count" nameKey="status" cx="50%" cy="45%" outerRadius={75}>
                  {statusRows.map((r) => (
                    <Cell key={r.status} fill={STATUS_COLORS[r.status] ?? "#40454f"} />
                  ))}
                </Pie>
                {/* recharts' Formatter<> generic doesn't narrow item.payload usefully — any is the
                    pragmatic escape hatch third-party charting callback types usually need. */}
                <Tooltip
                  formatter={(value: any, _name: any, item: any) => [
                    value,
                    STATUS_LABELS[item.payload.status] ?? item.payload.status,
                  ]}
                />
                <Legend
                  formatter={(_value, entry) => STATUS_LABELS[(entry.payload as { status: string }).status]}
                  wrapperStyle={{ fontSize: 12, color: "var(--ds-text-muted)" }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="animate-fade-in rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-ds-text">Guardrail block rate by category</h3>
          {Object.keys(summary.quality.by_category).length === 0 ? (
            <p className="muted mt-2">No categorized data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={Object.entries(summary.quality.by_category).map(([category, m]) => ({
                  category,
                  rate: m.guardrail_block_rate ?? 0,
                }))}
              >
                {/* Hairline, solid, recessive — never dashed (dataviz skill's mark spec). */}
                <CartesianGrid stroke="#e3e5ea" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: "#676c76" }} axisLine={{ stroke: "#e3e5ea" }} tickLine={false} />
                <YAxis
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 11, fill: "#676c76" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(0)}%`} cursor={{ fill: "#f4f5f7" }} />
                {/* 4px rounded data-end, capped thickness (dataviz skill's bar spec). */}
                <Bar dataKey="rate" fill={GUARDRAIL_RATE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="animate-fade-in mt-6 rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ds-text">Latest eval run</h3>
        {summary.eval_summary.available ? (
          <div className="mt-2 flex flex-wrap gap-4">
            {Object.entries(summary.eval_summary.metrics).map(([key, value], i) => (
              <MetricTile
                key={key}
                label={key.replace(/_/g, " ")}
                value={formatPercent(value)}
                style={{ animationDelay: `${i * 70}ms` }}
              />
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
