import { pool } from "../pool.js";
import type { RawDraftOutput, ResolutionType } from "../../domain/schemas.js";

export interface NewDraft {
  draft_id: string;
  ticket_id: string;
  run_id: string;
  resolution_type: ResolutionType;
  body: string;
  citations: string[];
  recommended_actions: RawDraftOutput["recommended_actions"];
  // V2-4 (LLD_v2 §1): the inbound message this draft answers. Nullable only
  // for defensiveness — every ticket has a thread by the time drafting runs
  // (backfill migration + POST /tickets both create the initial message).
  message_id: string | null;
}

export interface DraftRow extends NewDraft {
  status: string;
  created_at: string;
}

export async function getDraftById(draftId: string): Promise<DraftRow | null> {
  const { rows } = await pool.query(
    `SELECT draft_id, ticket_id, run_id, status, resolution_type, body, citations,
            recommended_actions, message_id, created_at::text
     FROM drafts WHERE draft_id = $1`,
    [draftId]
  );
  return rows[0] ?? null;
}

export async function insertDraft(draft: NewDraft): Promise<DraftRow> {
  const { rows } = await pool.query(
    `INSERT INTO drafts (draft_id, ticket_id, run_id, resolution_type, body, citations, recommended_actions, message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING draft_id, ticket_id, run_id, status, resolution_type, body, citations,
               recommended_actions, message_id, created_at::text`,
    [
      draft.draft_id,
      draft.ticket_id,
      draft.run_id,
      draft.resolution_type,
      draft.body,
      JSON.stringify(draft.citations),
      JSON.stringify(draft.recommended_actions),
      draft.message_id,
    ]
  );
  return rows[0];
}

// V2-4 (LLD_v2 §5): POST /drafts/:id/send moves a draft to 'sent' — the
// only status transition on drafts driven by v2 code (the others —
// edited/approved/rejected — remain unused, same as v1).
export async function updateDraftStatus(draftId: string, status: string): Promise<void> {
  await pool.query(`UPDATE drafts SET status = $2 WHERE draft_id = $1`, [draftId, status]);
}
