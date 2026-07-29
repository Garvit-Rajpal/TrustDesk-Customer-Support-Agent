import { useEffect, useState } from "react";
import { api, type Customer, type TicketSummary } from "../api.js";
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
  const [showNewTicket, setShowNewTicket] = useState(false);

  function loadTickets() {
    return api
      .listTickets()
      .then((res) => setTickets(res.tickets))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTickets();
  }, []);

  if (loading) return <p>Loading tickets…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <div className="actions-row">
        <button className="link-button" onClick={() => setShowNewTicket((v) => !v)}>
          {showNewTicket ? "Hide" : "+ New ticket"}
        </button>
      </div>
      {showNewTicket && (
        <NewTicketForm
          onCreated={(ticketId) => {
            setShowNewTicket(false);
            loadTickets().then(() => onSelect(ticketId));
          }}
        />
      )}
      <DataTable
        columns={COLUMNS}
        rows={tickets}
        rowKey={(t) => t.ticket_id}
        onRowClick={(t) => onSelect(t.ticket_id)}
      />
    </div>
  );
}

// V2-5 follow-up: POST /tickets (ADR-5) always existed on the backend, but
// had no frontend UI — this closes that gap. It also needs a customer_id,
// and a freshly onboarded org (V2-5) starts with none, so this offers
// "pick an existing customer" OR "create one inline" in the same form
// rather than requiring a separate trip to a customers page first.
function NewTicketForm({ onCreated }: { onCreated: (ticketId: string) => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [newCustomerCountry, setNewCustomerCountry] = useState("");
  const [channel, setChannel] = useState("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .listCustomers()
      .then((res) => {
        setCustomers(res.customers);
        // No existing customers (e.g. a brand-new org) — default straight
        // to "create one inline" instead of showing an empty dropdown.
        if (res.customers.length === 0) setCustomerMode("new");
        else setCustomerId(res.customers[0]!.customer_id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load customers"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let resolvedCustomerId = customerId;
      if (customerMode === "new") {
        const created = await api.createCustomer({
          name: newCustomerName,
          email: newCustomerEmail,
          country: newCustomerCountry,
        });
        resolvedCustomerId = created.customer_id;
      }
      const ticket = await api.createTicket({ customer_id: resolvedCustomerId, channel, subject, body });
      onCreated(ticket.ticket_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ingest-form">
      <label>
        Customer
        <select
          value={customerMode}
          onChange={(e) => setCustomerMode(e.target.value as "existing" | "new")}
        >
          <option value="existing" disabled={customers.length === 0}>
            Existing customer
          </option>
          <option value="new">New customer</option>
        </select>
      </label>

      {customerMode === "existing" ? (
        <label>
          Select customer
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            {customers.map((c) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.name} ({c.customer_id})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="ingest-row">
          <label>
            Name
            <input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} required />
          </label>
          <label>
            Email
            <input
              type="email"
              value={newCustomerEmail}
              onChange={(e) => setNewCustomerEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Country
            <input
              value={newCustomerCountry}
              onChange={(e) => setNewCustomerCountry(e.target.value)}
              required
            />
          </label>
        </div>
      )}

      <label>
        Channel
        <input value={channel} onChange={(e) => setChannel(e.target.value)} required />
      </label>
      <label>
        Subject
        <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </label>
      <label>
        Body
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} required />
      </label>

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create ticket"}
      </button>
    </form>
  );
}
