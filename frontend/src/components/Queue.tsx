import { useEffect, useState } from "react";
import { api, type TicketSummary } from "../api.js";

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
    <table className="queue-table">
      <thead>
        <tr>
          <th>Ticket</th>
          <th>Subject</th>
          <th>Status</th>
          <th>Category</th>
          <th>Priority</th>
          <th>Escalate?</th>
        </tr>
      </thead>
      <tbody>
        {tickets.map((t) => (
          <tr key={t.ticket_id} onClick={() => onSelect(t.ticket_id)} className="clickable-row">
            <td>{t.ticket_id}</td>
            <td>{t.subject}</td>
            <td>{t.status}</td>
            <td>{t.triage?.category ?? "—"}</td>
            <td>{t.triage?.priority ?? "—"}</td>
            <td>{t.triage ? (t.triage.should_escalate ? "yes" : "no") : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
