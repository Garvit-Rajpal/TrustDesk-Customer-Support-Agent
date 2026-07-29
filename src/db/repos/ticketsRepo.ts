import { pool } from "../pool.js";
import { Ticket, SeedTicket } from "../../domain/entities.js";
import type { TicketStatus, TriageResult } from "../../domain/schemas.js";

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

// LLD §4.6: triage result persisted on the ticket (latest result only, no
// history table in v1). Only called after a successful classification —
// a failed run leaves the ticket's prior triage state untouched.
export async function updateTicketTriage(ticketId: string, triage: TriageResult): Promise<void> {
  await pool.query(`UPDATE tickets SET triage = $2 WHERE ticket_id = $1`, [
    ticketId,
    JSON.stringify(triage),
  ]);
}

// V2-4 (LLD_v2 §5): legality is enforced by the caller (services/ticketStatus.ts
// canTransition) before this is ever called — this repo function just writes.
export async function updateTicketStatus(ticketId: string, status: TicketStatus): Promise<void> {
  await pool.query(`UPDATE tickets SET status = $2 WHERE ticket_id = $1`, [ticketId, status]);
}

export interface TicketFilters {
  status?: string;
  category?: string;
}

// category filters on triage->>'category' (LLD §4.4: "GET /tickets?status=&category=").
// Untriaged tickets never match a category filter — triage is null until run.
export async function listTickets(filters: TicketFilters = {}): Promise<Ticket[]> {
  const conditions: string[] = [];
  const params: string[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`triage->>'category' = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT ticket_id, customer_id, order_id, channel, subject, body, status, created_at::text, triage
     FROM tickets ${where} ORDER BY created_at`,
    params
  );
  return rows.map((row) => Ticket.parse(row));
}

export interface NewTicketInput {
  ticket_id: string;
  customer_id: string;
  order_id: string | null;
  channel: string;
  subject: string;
  body: string;
  created_at: string;
}

// Demo ticket creation (ADR-5). body is stored exactly as given — never
// trimmed or otherwise mutated (HLD invariant #8).
export async function insertTicket(ticket: NewTicketInput): Promise<Ticket> {
  const { rows } = await pool.query(
    `INSERT INTO tickets (ticket_id, customer_id, order_id, channel, subject, body, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7)
     RETURNING ticket_id, customer_id, order_id, channel, subject, body, status, created_at::text, triage`,
    [
      ticket.ticket_id,
      ticket.customer_id,
      ticket.order_id,
      ticket.channel,
      ticket.subject,
      ticket.body,
      ticket.created_at,
    ]
  );
  return Ticket.parse(rows[0]);
}
