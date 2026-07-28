import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V2-1 (LLD_v2 §1/§2, ADR-8): persisted pipeline events so the SSE endpoint
// can replay a run's stage-by-stage history identically to how it streamed
// live. `summary` is redacted before it ever reaches this table — see
// src/services/events/redactSummary.ts, the single gate.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    -- No FK to agent_runs: stage events are written incrementally as a run
    -- progresses (LLD_v2 §2), and the agent_runs row itself is only
    -- inserted once the whole run finishes (HLD invariant #6) — a FK here
    -- would reject every event except the very last one.
    CREATE TABLE run_events (
      event_id  bigserial PRIMARY KEY,
      run_id    text NOT NULL,
      stage     text NOT NULL CHECK (stage IN
                ('input_scan','triage','retrieval','eligibility','draft_generation','output_scan')),
      status    text NOT NULL CHECK (status IN ('started','completed','failed','blocked')),
      summary   jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX run_events_run_id_idx ON run_events (run_id, event_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS run_events;`);
}
