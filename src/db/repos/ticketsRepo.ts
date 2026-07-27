import { pool } from "../pool.js";
import { Ticket, SeedTicket } from "../../domain/entities.js";

export async function upsertSeedTicket(ticket: SeedTicket): Promise<void> {
  await pool.query(
    `INSERT INTO tickets (ticket_id, customer_id, order_id, channel, subject, body, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ticket_id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id, order_id = EXCLUDED.order_id,
       channel = EXCLUDED.channel, subject = EXCLUDED.subject, body = EXCLUDED.body,
       status = EXCLUDED.status, created_at = EXCLUDED.created_at`,
    [
      ticket.ticket_id,
      ticket.customer_id,
      ticket.order_id,
      ticket.channel,
      ticket.subject,
      ticket.body,
      ticket.status,
      ticket.created_at,
    ]
  );
}

// Selects only runtime-visible columns — no expected_* labels ever leave
// this repo (HLD invariant #4: those live only in ticket_expected_labels,
// read by the EvalRunner / seed loader).
export async function getTicketById(ticketId: string): Promise<Ticket | null> {
  const { rows } = await pool.query(
    `SELECT ticket_id, customer_id, order_id, channel, subject, body, status, created_at::text, triage
     FROM tickets WHERE ticket_id = $1`,
    [ticketId]
  );
  if (rows.length === 0) return null;
  return Ticket.parse(rows[0]);
}

export async function listTickets(): Promise<Ticket[]> {
  const { rows } = await pool.query(
    `SELECT ticket_id, customer_id, order_id, channel, subject, body, status, created_at::text, triage
     FROM tickets ORDER BY created_at`
  );
  return rows.map((row) => Ticket.parse(row));
}
