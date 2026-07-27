import { pool } from "../pool.js";
import type { SeedTicket } from "../../domain/entities.js";

export async function upsertExpectedLabels(ticket: SeedTicket): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_expected_labels
       (ticket_id, expected_category, expected_priority, expected_sentiment, expected_escalation, expected_actions)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (ticket_id) DO UPDATE SET
       expected_category = EXCLUDED.expected_category,
       expected_priority = EXCLUDED.expected_priority,
       expected_sentiment = EXCLUDED.expected_sentiment,
       expected_escalation = EXCLUDED.expected_escalation,
       expected_actions = EXCLUDED.expected_actions`,
    [
      ticket.ticket_id,
      ticket.expected_category ?? null,
      ticket.expected_priority ?? null,
      ticket.expected_sentiment ?? null,
      ticket.expected_escalation ?? null,
      JSON.stringify(ticket.expected_actions ?? []),
    ]
  );
}

export interface ExpectedLabels {
  ticket_id: string;
  expected_category: string | null;
  expected_priority: string | null;
  expected_sentiment: string | null;
  expected_escalation: boolean | null;
  expected_actions: string[] | null;
}

// Only the EvalRunner scorer and seed loader may call this (HLD invariant #4,
// LLD §2: table is physically separated so runtime services can't join it by
// accident).
export async function getExpectedLabels(ticketId: string): Promise<ExpectedLabels | null> {
  const { rows } = await pool.query(
    `SELECT ticket_id, expected_category, expected_priority, expected_sentiment,
            expected_escalation, expected_actions
     FROM ticket_expected_labels WHERE ticket_id = $1`,
    [ticketId]
  );
  return rows[0] ?? null;
}
