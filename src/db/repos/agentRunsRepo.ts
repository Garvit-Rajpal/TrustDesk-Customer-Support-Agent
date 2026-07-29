import { pool } from "../pool.js";
import type { GuardrailResult, RunStatus, RunType } from "../../domain/schemas.js";
import type { CategorizedAgentRun } from "../../services/qualityMetrics.js";

export interface NewAgentRun {
  run_id: string;
  ticket_id: string | null;
  run_type: RunType;
  status: RunStatus;
  retrieved_doc_ids: string[];
  tool_calls: unknown[];
  guardrail_results: GuardrailResult[];
  rejected_output?: unknown;
  model_provider?: string;
  model_name?: string;
  latency_ms?: number;
}

// ADR-6: every AI run writes this row synchronously, before the API
// responds — never as an end-of-flow audit step.
export async function insertAgentRun(run: NewAgentRun): Promise<void> {
  await pool.query(
    `INSERT INTO agent_runs
       (run_id, ticket_id, run_type, status, retrieved_doc_ids, tool_calls,
        guardrail_results, rejected_output, model_provider, model_name, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      run.run_id,
      run.ticket_id,
      run.run_type,
      run.status,
      JSON.stringify(run.retrieved_doc_ids),
      JSON.stringify(run.tool_calls),
      JSON.stringify(run.guardrail_results),
      run.rejected_output != null ? JSON.stringify(run.rejected_output) : null,
      run.model_provider ?? null,
      run.model_name ?? null,
      run.latency_ms ?? null,
    ]
  );
}

export interface AgentRunRow {
  run_id: string;
  ticket_id: string | null;
  run_type: string;
  status: string;
  retrieved_doc_ids: unknown;
  tool_calls: unknown;
  guardrail_results: unknown;
  rejected_output: unknown;
  model_provider: string | null;
  model_name: string | null;
  latency_ms: number | null;
  created_at: string;
}

// V2-3 (LLD_v2 §4): draft_reply runs only (guardrail_block_rate is about
// draft output scans — triage runs can never reach "guardrail_blocked",
// see src/services/triage.ts) joined out to the ticket's triage category.
export async function getCategorizedDraftRuns(): Promise<CategorizedAgentRun[]> {
  const { rows } = await pool.query(`
    SELECT t.triage->>'category' AS category, ar.status
    FROM agent_runs ar
    JOIN tickets t ON ar.ticket_id = t.ticket_id
    WHERE ar.run_type = 'draft_reply' AND t.triage IS NOT NULL
  `);
  return rows;
}

export async function getAgentRunById(runId: string): Promise<AgentRunRow | null> {
  const { rows } = await pool.query(
    `SELECT run_id, ticket_id, run_type, status, retrieved_doc_ids, tool_calls,
            guardrail_results, rejected_output, model_provider, model_name,
            latency_ms, created_at::text
     FROM agent_runs WHERE run_id = $1`,
    [runId]
  );
  return rows[0] ?? null;
}
