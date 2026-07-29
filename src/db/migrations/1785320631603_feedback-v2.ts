import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V2-3 (LLD_v2 §1/§4, ADR-9 workstream W3): the `feedback` table existed
// from v1 but was never written to (designed early, LLD §8 "Good To Have").
// This activates it: reviewer_id ties a rating to the JWT user who gave it,
// and the unique index is what makes POST /drafts/:id/feedback an upsert
// ("one feedback per reviewer per draft ... repeat submissions update")
// instead of accumulating duplicate rows.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE feedback ADD COLUMN reviewer_id text REFERENCES users;
    ALTER TABLE feedback ADD CONSTRAINT feedback_rating_check CHECK (rating BETWEEN 1 AND 5);
    CREATE UNIQUE INDEX feedback_draft_reviewer_idx ON feedback (draft_id, reviewer_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP INDEX IF EXISTS feedback_draft_reviewer_idx;
    ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_rating_check;
    ALTER TABLE feedback DROP COLUMN IF EXISTS reviewer_id;
  `);
}
