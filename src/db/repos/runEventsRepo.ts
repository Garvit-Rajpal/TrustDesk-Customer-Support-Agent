import { pool } from "../pool.js";
import type { PipelineEventStatus, PipelineStage } from "../../domain/schemas.js";

export interface NewRunEvent {
  run_id: string;
  stage: PipelineStage;
  status: PipelineEventStatus;
  summary: Record<string, unknown>;
}

// V2-1 (LLD_v2 §2): persisted per-stage, synchronously — SSE replay for
// historical runs reads straight from this table (ADR-8: "live and post-hoc
// views share one component").
export async function insertRunEvent(event: NewRunEvent): Promise<void> {
  await pool.query(
    `INSERT INTO run_events (run_id, stage, status, summary) VALUES ($1, $2, $3, $4)`,
    [event.run_id, event.stage, event.status, JSON.stringify(event.summary)]
  );
}

export interface RunEventRow {
  event_id: string;
  run_id: string;
  stage: string;
  status: string;
  summary: unknown;
  created_at: string;
}

export async function listRunEventsByRunId(runId: string): Promise<RunEventRow[]> {
  const { rows } = await pool.query(
    `SELECT event_id, run_id, stage, status, summary, created_at::text
     FROM run_events WHERE run_id = $1 ORDER BY run_events.event_id ASC`,
    [runId]
  );
  return rows;
}
