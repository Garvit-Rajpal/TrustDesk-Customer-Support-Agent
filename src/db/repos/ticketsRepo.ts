import { pool } from "../pool.js";
import { Ticket, SeedTicket } from "../../domain/entities.js";
import type { TicketStatus, TriageResult } from "../../domain/schemas.js";
import type { OrgContext } from "../../domain/orgContext.js";

// Seed-loader only, same org_id default reasoning as customersRepo.upsertCustomer.
export async function upsertSeedTicket(ticket: SeedTicket, orgId = "org_default"): Promise<void> {
  await pool.query(
    `INSERT INTO tickets (ticket_id, customer_id, order_id, channel, subject, body, status, created_at, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (ticket_id) DO UPDATE SET
       customer_id = EXCLUDED.customer_id, order_id = EXCLUDED.order_id,
       channel = EXCLUDED.channel, subject = EXCLUDED.subject, body = EXCLUDED.body,
       status = EXCLUDED.status, created_at = EXCLUDED.created_at, org_id = EXCLUDED.org_id`,
    [
      ticket.ticket_id,
      ticket.customer_id,
      ticket.order_id,
      ticket.channel,
      ticket.subject,
      ticket.body,
      ticket.status,
      ticket.created_at,
      orgId,
    ]
  );
}

// Selects only runtime-visible columns — no expected_* labels ever leave
// this repo (HLD invariant #4: those live only in ticket_expected_labels,
// read by the EvalRunner / seed loader). V2-5: org_id filter is the
// isolation boundary — a ticket_id from another org 404s exactly like a
// nonexistent one.
export async function getTicketById(ctx: OrgContext, ticketId: string): Promise<Ticket | null> {
  const { rows } = await pool.query(
    `SELECT ticket_id, customer_id, order_id, channel, subject, body, status, created_at::text, triage,
            human_owned, human_owned_by, human_owned_at::text
     FROM tickets WHERE ticket_id = $1 AND org_id = $2`,
    [ticketId, ctx.org_id]
  );
  if (rows.length === 0) return null;
  return Ticket.parse(rows[0]);
}

// LLD §4.6: triage result persisted on the ticket (latest result only, no
// history table in v1). Only called after a successful classification —
// a failed run leaves the ticket's prior triage state untouched.
export async function updateTicketTriage(
  ctx: OrgContext,
  ticketId: string,
  triage: TriageResult
): Promise<void> {
  await pool.query(`UPDATE tickets SET triage = $3 WHERE ticket_id = $1 AND org_id = $2`, [
    ticketId,
    ctx.org_id,
    JSON.stringify(triage),
  ]);
}

// V2-4 (LLD_v2 §5): legality is enforced by the caller (services/ticketStatus.ts
// canTransition) before this is ever called — this repo function just writes.
export async function updateTicketStatus(
  ctx: OrgContext,
  ticketId: string,
  status: TicketStatus
): Promise<void> {
  await pool.query(`UPDATE tickets SET status = $3 WHERE ticket_id = $1 AND org_id = $2`, [
    ticketId,
    ctx.org_id,
    status,
  ]);
}

export interface TicketFilters {
  status?: string;
  category?: string;
}

// category filters on triage->>'category' (LLD §4.4: "GET /tickets?status=&category=").
// Untriaged tickets never match a category filter — triage is null until run.
export async function listTickets(ctx: OrgContext, filters: TicketFilters = {}): Promise<Ticket[]> {
  const conditions: string[] = ["org_id = $1"];
  const params: string[] = [ctx.org_id];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`triage->>'category' = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT ticket_id, customer_id, order_id, channel, subject, body, status, created_at::text, triage,
            human_owned, human_owned_by, human_owned_at::text
     FROM tickets WHERE ${conditions.join(" AND ")} ORDER BY created_at`,
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
export async function insertTicket(ctx: OrgContext, ticket: NewTicketInput): Promise<Ticket> {
  const { rows } = await pool.query(
    `INSERT INTO tickets (ticket_id, customer_id, order_id, channel, subject, body, status, created_at, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', $7, $8)
     RETURNING ticket_id, customer_id, order_id, channel, subject, body, status, created_at::text, triage,
               human_owned, human_owned_by, human_owned_at::text`,
    [
      ticket.ticket_id,
      ticket.customer_id,
      ticket.order_id,
      ticket.channel,
      ticket.subject,
      ticket.body,
      ticket.created_at,
      ctx.org_id,
    ]
  );
  return Ticket.parse(rows[0]);
}

// V3-4 (LLD_v3 §3, HLD_v3 ADR-15): idempotent — a second manual reply on an
// already-human-owned ticket is a no-op here (WHERE ... AND human_owned =
// false means the second call simply updates zero rows).
export async function markHumanOwned(ctx: OrgContext, ticketId: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE tickets SET human_owned = true, human_owned_by = $3, human_owned_at = now()
     WHERE ticket_id = $1 AND org_id = $2 AND human_owned = false`,
    [ticketId, ctx.org_id, userId]
  );
}
