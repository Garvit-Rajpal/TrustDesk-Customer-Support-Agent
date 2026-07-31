import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V4-5 (LLD_v4 §1/§4, HLD_v4 ADR-20): additive CHECK-constraint extension —
// eval-run streaming (W14) reuses the existing run_events/PipelineEventBus
// machinery with one new PipelineStage value, "eval_case", rather than a
// parallel table.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE run_events DROP CONSTRAINT run_events_stage_check;
    ALTER TABLE run_events ADD CONSTRAINT run_events_stage_check
      CHECK (stage IN
        ('input_scan','triage','retrieval','eligibility','draft_generation','output_scan','eval_case'));
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE run_events DROP CONSTRAINT run_events_stage_check;
    ALTER TABLE run_events ADD CONSTRAINT run_events_stage_check
      CHECK (stage IN
        ('input_scan','triage','retrieval','eligibility','draft_generation','output_scan'));
  `);
}
