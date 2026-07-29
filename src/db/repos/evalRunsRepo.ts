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
export async function insertEvalRun(ctx: OrgContext, run: NewEvalRun): Promise<void> {
  await pool.query(
    `INSERT INTO eval_runs (eval_run_id, started_at, completed_at, total_cases, metrics, case_results, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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

export async function getEvalRunById(ctx: OrgContext, evalRunId: string): Promise<EvalRunRow | null> {
  const { rows } = await pool.query(
    `SELECT eval_run_id, started_at::text, completed_at::text, total_cases, metrics, case_results
     FROM eval_runs WHERE eval_run_id = $1 AND org_id = $2`,
    [evalRunId, ctx.org_id]
  );
  return rows[0] ?? null;
}
