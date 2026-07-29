import { useState } from "react";
import { api, type QualityReport, type TicketMessage, type TicketSummary } from "../api.js";
import { DataTable, type DataTableColumn } from "../design-system/DataTable.js";
import { StatusBadge } from "../design-system/StatusBadge.js";
import { MetricTile } from "../design-system/MetricTile.js";

const COLUMNS: DataTableColumn<TicketSummary>[] = [
  { key: "ticket_id", header: "Ticket", render: (t) => t.ticket_id },
  { key: "subject", header: "Subject", render: (t) => t.subject },
  { key: "status", header: "Status", render: (t) => <StatusBadge value={t.status} /> },
  { key: "category", header: "Category", render: (t) => t.triage?.category ?? "—" },
];

// V3-6/V3-9 (LLD_v3 §4/§6, HLD_v3 ADR-16): read-only cross-org view for
// org_default agents — never merged into org_default's own queue (resolved
// decision #3). Since there's no "list orgs" endpoint, the operator enters a
// target org_id directly (visible on that org's own Admin/onboarding
// screen) — consent/404/403 all surface as a plain error string.
export function PlatformSupport() {
  const [targetOrgId, setTargetOrgId] = useState("");
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [metrics, setMetrics] = useState<QualityReport | null>(null);
  const [selected, setSelected] = useState<TicketSummary | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLoad(e: React.FormEvent) {
    e.preventDefault();
    if (!targetOrgId.trim()) return;
    setError(null);
    setBusy(true);
    setSelected(null);
    setMessages([]);
    try {
      const [ticketsRes, metricsRes] = await Promise.all([
        api.platformTickets(targetOrgId.trim()),
        api.platformMetrics(targetOrgId.trim()),
      ]);
      setTickets(ticketsRes.tickets);
      setMetrics(metricsRes);
    } catch (err) {
      setTickets(null);
      setMetrics(null);
      setError(err instanceof Error ? err.message : "Failed to load platform data");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(ticket: TicketSummary) {
    setSelected(ticket);
    setMessages([]);
    try {
      const res = await api.platformTicketMessages(targetOrgId.trim(), ticket.ticket_id);
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread");
    }
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-ds-text">Platform support</h2>
      <p className="muted">
        Read-only visibility into a tenant's tickets — only available for orgs that opted in via their consent
        settings. No triage/draft/reply actions are available here.
      </p>

      <form onSubmit={handleLoad} className="mt-3 flex gap-2">
        <input
          value={targetOrgId}
          onChange={(e) => setTargetOrgId(e.target.value)}
          placeholder="Target org_id (e.g. org_abc123)"
          className="flex-1 rounded-ds-md border border-ds-border px-3 py-2 text-sm"
        />
        <button disabled={busy || !targetOrgId.trim()} type="submit">
          {busy ? "Loading…" : "Load"}
        </button>
      </form>

      {error && <p className="error mt-2">{error}</p>}

      {metrics && (
        <div className="mt-4 flex flex-wrap gap-3">
          <MetricTile
            label="Draft acceptance"
            value={metrics.draft_acceptance_rate === null ? "no data" : `${(metrics.draft_acceptance_rate * 100).toFixed(0)}%`}
          />
          <MetricTile
            label="Action approval"
            value={metrics.action_approval_rate === null ? "no data" : `${(metrics.action_approval_rate * 100).toFixed(0)}%`}
          />
          <MetricTile label="Avg rating" value={metrics.avg_rating === null ? "no data" : `${metrics.avg_rating.toFixed(2)}/5`} />
        </div>
      )}

      {tickets && (
        <div className="mt-4">
          {tickets.length === 0 ? (
            <p className="muted">No tickets for this org.</p>
          ) : (
            <DataTable columns={COLUMNS} rows={tickets} rowKey={(t) => t.ticket_id} onRowClick={handleSelect} />
          )}
        </div>
      )}

      {selected && (
        <div className="mt-4 rounded-ds-lg border border-ds-border bg-ds-surface p-4">
          <h3 className="text-sm font-semibold text-ds-text">
            {selected.subject} <StatusBadge value={selected.status} />
          </h3>
          <div className="mt-2 space-y-2">
            {messages.map((m) => (
              <div key={m.message_id} className="rounded-ds-sm border border-ds-border p-2 text-sm">
                <div className="text-xs text-ds-text-muted">
                  {m.direction} · {m.author} · {m.created_at}
                </div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
