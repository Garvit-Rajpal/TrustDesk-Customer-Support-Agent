import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// RAG-pipeline visibility: draft.ts's similarity search (V4-13,
// searchSimilarResolutions()) already retrieves up to 3 nearest past
// resolutions from ticket_resolution_embeddings and feeds their text into
// the draft prompt — but until now that result was used in-memory and
// discarded, never persisted anywhere, so nothing about it was visible in
// the frontend. This column stores exactly what was retrieved and used for
// a given draft_reply run (embedding_id/ticket_id/distance/source_text per
// match), read back via GET /agent-runs/:runId (TracePanel) and the audit
// trail list. Defaults to '[]' — triage runs and any pre-existing row never
// had this data to begin with.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE agent_runs ADD COLUMN similar_resolutions jsonb NOT NULL DEFAULT '[]';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`ALTER TABLE agent_runs DROP COLUMN IF EXISTS similar_resolutions;`);
}
