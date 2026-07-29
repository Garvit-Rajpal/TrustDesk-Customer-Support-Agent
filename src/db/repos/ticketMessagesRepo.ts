import { pool } from "../pool.js";
import type { MessageDirection } from "../../domain/schemas.js";

export interface NewTicketMessage {
  message_id: string;
  ticket_id: string;
  direction: MessageDirection;
  body: string;
  author: string;
  draft_id?: string | null;
}

export interface TicketMessageRow extends NewTicketMessage {
  draft_id: string | null;
  created_at: string;
}

export async function insertMessage(message: NewTicketMessage): Promise<TicketMessageRow> {
  const { rows } = await pool.query(
    `INSERT INTO ticket_messages (message_id, ticket_id, direction, body, author, draft_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING message_id, ticket_id, direction, body, author, draft_id, created_at::text`,
    [message.message_id, message.ticket_id, message.direction, message.body, message.author, message.draft_id ?? null]
  );
  return rows[0];
}

// Seed loader upsert (LLD_v2 §1): deterministic message_id so re-seeding
// (truncateAll + runSeed, every test's beforeAll) is idempotent, mirroring
// the migration's backfill for pre-existing dev data.
export async function upsertSeedInboundMessage(
  ticketId: string,
  body: string,
  createdAt: string
): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_messages (message_id, ticket_id, direction, body, author, created_at)
     VALUES ($1, $2, 'inbound', $3, 'customer', $4)
     ON CONFLICT (message_id) DO UPDATE SET body = EXCLUDED.body, created_at = EXCLUDED.created_at`,
    [`msg_seed_${ticketId}`, ticketId, body, createdAt]
  );
}

export async function listMessagesByTicketId(ticketId: string): Promise<TicketMessageRow[]> {
  const { rows } = await pool.query(
    `SELECT message_id, ticket_id, direction, body, author, draft_id, created_at::text
     FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at`,
    [ticketId]
  );
  return rows;
}

export async function getLatestInboundMessage(ticketId: string): Promise<TicketMessageRow | null> {
  const { rows } = await pool.query(
    `SELECT message_id, ticket_id, direction, body, author, draft_id, created_at::text
     FROM ticket_messages WHERE ticket_id = $1 AND direction = 'inbound'
     ORDER BY created_at DESC LIMIT 1`,
    [ticketId]
  );
  return rows[0] ?? null;
}
