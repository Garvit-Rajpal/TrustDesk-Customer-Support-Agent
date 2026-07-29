import { pool } from "../pool.js";
import type { CategorizedFeedback } from "../../services/qualityMetrics.js";

export interface NewFeedback {
  feedback_id: string;
  ticket_id: string;
  draft_id: string;
  reviewer_id: string;
  rating: number;
  reason?: string;
  corrected_response?: string;
}

export interface FeedbackRow {
  feedback_id: string;
  ticket_id: string;
  draft_id: string;
  reviewer_id: string;
  rating: number;
  reason: string | null;
  corrected_response: string | null;
  created_at: string;
}

// V2-3 (LLD_v2 §4): "one feedback per reviewer per draft ... repeat
// submissions update" — ON CONFLICT on the (draft_id, reviewer_id) unique
// index from the migration. Returns whether this was a fresh insert (201)
// or an update (200) via the classic `xmax = 0` trick: a row's xmax is 0
// only immediately after an INSERT, never after an UPDATE.
export async function upsertFeedback(
  feedback: NewFeedback
): Promise<{ row: FeedbackRow; created: boolean }> {
  const { rows } = await pool.query(
    `INSERT INTO feedback (feedback_id, ticket_id, draft_id, reviewer_id, rating, reason, corrected_response)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (draft_id, reviewer_id) DO UPDATE SET
       rating = EXCLUDED.rating,
       reason = EXCLUDED.reason,
       corrected_response = EXCLUDED.corrected_response
     RETURNING feedback_id, ticket_id, draft_id, reviewer_id, rating, reason,
               corrected_response, created_at::text, (xmax = 0) AS inserted`,
    [
      feedback.feedback_id,
      feedback.ticket_id,
      feedback.draft_id,
      feedback.reviewer_id,
      feedback.rating,
      feedback.reason ?? null,
      feedback.corrected_response ?? null,
    ]
  );
  const { inserted, ...row } = rows[0];
  return { row, created: inserted };
}

// V2-3 (LLD_v2 §4): feedback rows joined out to the category of the ticket
// their draft belongs to, for GET /metrics/agent-quality's by_category
// breakdown. Rows whose ticket has no triage yet are excluded — there's no
// category to bucket them under.
export async function getCategorizedFeedback(): Promise<CategorizedFeedback[]> {
  const { rows } = await pool.query(`
    SELECT t.triage->>'category' AS category, f.rating
    FROM feedback f
    JOIN drafts d ON f.draft_id = d.draft_id
    JOIN tickets t ON d.ticket_id = t.ticket_id
    WHERE t.triage IS NOT NULL
  `);
  return rows;
}
