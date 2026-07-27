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
}

export interface DraftRow extends NewDraft {
  status: string;
  created_at: string;
}

export async function insertDraft(draft: NewDraft): Promise<DraftRow> {
  const { rows } = await pool.query(
    `INSERT INTO drafts (draft_id, ticket_id, run_id, resolution_type, body, citations, recommended_actions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING draft_id, ticket_id, run_id, status, resolution_type, body, citations,
               recommended_actions, created_at::text`,
    [
      draft.draft_id,
      draft.ticket_id,
      draft.run_id,
      draft.resolution_type,
      draft.body,
      JSON.stringify(draft.citations),
      JSON.stringify(draft.recommended_actions),
    ]
  );
  return rows[0];
}
