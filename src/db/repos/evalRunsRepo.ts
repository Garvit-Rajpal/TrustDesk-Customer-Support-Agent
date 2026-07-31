import { pool } from "../pool.js";
import type { EvalCaseResult, EvalMetrics } from "../../domain/evalTypes.js";
import type { OrgContext } from "../../domain/orgContext.js";

export interface NewEvalRun {
  eval_run_id: string;
  started_at: string;
  completed_at: string;
  total_cases: number;
  metrics: EvalMetrics;
  case_results: EvalCaseResult[];
}

export interface EvalRunRow {
  eval_run_id: string;
  started_at: string;
  completed_at: string | null;
  total_cases: number;
  metrics: EvalMetrics | null;
  case_results: EvalCaseResult[] | null;
}

// V2-5 (LLD_v2 §6): "Eval runner: scoped to org_default (the only org with
// seeded eval cases)" — the caller always passes org_default's context, but
// the row is still stamped and read back org-scoped for consistency with
// every other repo.
// V4-6 (LLD_v4 §4): upsert, not a plain insert — POST /eval-runs/start may
// already have written a pending row (insertPendingEvalRun below) for this
// exact eval_run_id, which this call then completes in place.
export async function insertEvalRun(ctx: OrgContext, run: NewEvalRun): Promise<void> {
  await pool.query(
    `INSERT INTO eval_runs (eval_run_id, started_at, completed_at, total_cases, metrics, case_results, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (eval_run_id) DO UPDATE SET
       completed_at = EXCLUDED.completed_at, total_cases = EXCLUDED.total_cases,
       metrics = EXCLUDED.metrics, case_results = EXCLUDED.case_results`,
    [
      run.eval_run_id,
      run.started_at,
      run.completed_at,
      run.total_cases,
      JSON.stringify(run.metrics),
      JSON.stringify(run.case_results),
      ctx.org_id,
    ]
  );
}

// V4-6 (LLD_v4 §4, HLD_v4 ADR-20): POST /eval-runs/start persists this
// pending row (completed_at/metrics/case_results all null — columns already
// nullable, designed for exactly this shape since v1's init-schema) so
// GET /eval-runs/:runId/events can tell "minted but not started yet" (row
// exists, subscribe live) apart from "unknown id" (no row, no events, 404)
// — closing a race where a client's SSE connection opens before the run's
// first event has actually persisted.
export async function insertPendingEvalRun(
  ctx: OrgContext,
  run: { eval_run_id: string; started_at: string }
): Promise<void> {
  await pool.query(
    `INSERT INTO eval_runs (eval_run_id, started_at, total_cases, org_id)
     VALUES ($1, $2, 0, $3)`,
    [run.eval_run_id, run.started_at, ctx.org_id]
  );
}

export async function getEvalRunById(ctx: OrgContext, evalRunId: string): Promise<EvalRunRow | null> {
  const { rows } = await pool.query(
    `SELECT eval_run_id, started_at::text, completed_at::text, total_cases, metrics, case_results
     FROM eval_runs WHERE eval_run_id = $1 AND org_id = $2`,
    [evalRunId, ctx.org_id]
  );
  return rows[0] ?? null;
}

// V3-7 (LLD_v3 §5): dashboard's eval-summary tile — most recently completed
// run only, no history. Never called for a non-org_default ctx in practice
// (the eval runner remains org_default-only, unchanged from v2), but scoped
// by org_id regardless for consistency with every other repo function.
// V4-6 (LLD_v4 §4): explicitly excludes pending rows (insertPendingEvalRun)
// — Dashboard.tsx does `Object.entries(eval_summary.metrics)` unconditionally
// whenever `available` is true, so a pending run (metrics still null) must
// never surface here, even if it's the only row that exists yet.
export async function getLatestEvalRun(ctx: OrgContext): Promise<EvalRunRow | null> {
  const { rows } = await pool.query(
    `SELECT eval_run_id, started_at::text, completed_at::text, total_cases, metrics, case_results
     FROM eval_runs WHERE org_id = $1 AND completed_at IS NOT NULL
     ORDER BY completed_at DESC LIMIT 1`,
    [ctx.org_id]
  );
  return rows[0] ?? null;
}
