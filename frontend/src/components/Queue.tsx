import { useEffect, useState } from "react";
import { api, type TicketSummary } from "../api.js";
import { DataTable, type DataTableColumn } from "../design-system/DataTable.js";
import { StatusBadge } from "../design-system/StatusBadge.js";

const COLUMNS: DataTableColumn<TicketSummary>[] = [
  { key: "ticket_id", header: "Ticket", render: (t) => t.ticket_id },
  { key: "subject", header: "Subject", render: (t) => t.subject },
  { key: "status", header: "Status", render: (t) => <StatusBadge value={t.status} /> },
  { key: "category", header: "Category", render: (t) => t.triage?.category ?? "—" },
  {
    key: "priority",
    header: "Priority",
    render: (t) => (t.triage ? <StatusBadge value={t.triage.priority} /> : "—"),
  },
  {
    key: "escalate",
    header: "Escalate?",
    render: (t) => (t.triage ? (t.triage.should_escalate ? "yes" : "no") : "—"),
  },
];

export function Queue({ onSelect }: { onSelect: (ticketId: string) => void }) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listTickets()
      .then((res) => setTickets(res.tickets))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading tickets…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <DataTable columns={COLUMNS} rows={tickets} rowKey={(t) => t.ticket_id} onRowClick={(t) => onSelect(t.ticket_id)} />
  );
}
