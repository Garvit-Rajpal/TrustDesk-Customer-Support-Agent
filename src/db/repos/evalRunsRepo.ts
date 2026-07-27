import { pool } from "../pool.js";
import type { EvalCaseResult, EvalMetrics } from "../../domain/evalTypes.js";

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

export async function insertEvalRun(run: NewEvalRun): Promise<void> {
  await pool.query(
    `INSERT INTO eval_runs (eval_run_id, started_at, completed_at, total_cases, metrics, case_results)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      run.eval_run_id,
      run.started_at,
      run.completed_at,
      run.total_cases,
      JSON.stringify(run.metrics),
      JSON.stringify(run.case_results),
    ]
  );
}

export async function getEvalRunById(evalRunId: string): Promise<EvalRunRow | null> {
  const { rows } = await pool.query(
    `SELECT eval_run_id, started_at::text, completed_at::text, total_cases, metrics, case_results
     FROM eval_runs WHERE eval_run_id = $1`,
    [evalRunId]
  );
  return rows[0] ?? null;
}
