import { pool } from "../pool.js";
import type { MessageDirection } from "../../domain/schemas.js";
import type { OrgContext } from "../../domain/orgContext.js";

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

// ticket_messages has no org_id column of its own (LLD_v2 §1 lists only
// the ten directly org-scoped tables) — isolation here is transitive
// through ticket_id: every caller has already fetched the parent ticket
// via ticketsRepo.getTicketById(ctx, ...), which 404s on a cross-org id
// before any of these functions are ever reached. ctx is still threaded
// through and joined against tickets.org_id below as defense in depth,
// consistent with "every repository method takes an OrgContext first".
export async function insertMessage(ctx: OrgContext, message: NewTicketMessage): Promise<TicketMessageRow> {
  const { rows } = await pool.query(
    `INSERT INTO ticket_messages (message_id, ticket_id, direction, body, author, draft_id)
     SELECT $1, $2, $3, $4, $5, $6
     WHERE EXISTS (SELECT 1 FROM tickets WHERE ticket_id = $2 AND org_id = $7)
     RETURNING message_id, ticket_id, direction, body, author, draft_id, created_at::text`,
    [
      message.message_id,
      message.ticket_id,
      message.direction,
      message.body,
      message.author,
      message.draft_id ?? null,
      ctx.org_id,
    ]
  );
  if (rows.length === 0) {
    throw new Error(`Ticket ${message.ticket_id} not found in org ${ctx.org_id}`);
  }
  return rows[0];
}

// Seed loader upsert (LLD_v2 §1): deterministic message_id so re-seeding
// (truncateAll + runSeed, every test's beforeAll) is idempotent, mirroring
// the migration's backfill for pre-existing dev data. No OrgContext — the
// seed loader creates every ticket as org_default itself, same reasoning
// as ticketsRepo.upsertSeedTicket.
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

export async function listMessagesByTicketId(
  ctx: OrgContext,
  ticketId: string
): Promise<TicketMessageRow[]> {
  const { rows } = await pool.query(
    `SELECT tm.message_id, tm.ticket_id, tm.direction, tm.body, tm.author, tm.draft_id, tm.created_at::text
     FROM ticket_messages tm
     JOIN tickets t ON t.ticket_id = tm.ticket_id
     WHERE tm.ticket_id = $1 AND t.org_id = $2
     ORDER BY tm.created_at`,
    [ticketId, ctx.org_id]
  );
  return rows;
}

export async function getLatestInboundMessage(
  ctx: OrgContext,
  ticketId: string
): Promise<TicketMessageRow | null> {
  const { rows } = await pool.query(
    `SELECT tm.message_id, tm.ticket_id, tm.direction, tm.body, tm.author, tm.draft_id, tm.created_at::text
     FROM ticket_messages tm
     JOIN tickets t ON t.ticket_id = tm.ticket_id
     WHERE tm.ticket_id = $1 AND t.org_id = $2 AND tm.direction = 'inbound'
     ORDER BY tm.created_at DESC LIMIT 1`,
    [ticketId, ctx.org_id]
  );
  return rows[0] ?? null;
}
