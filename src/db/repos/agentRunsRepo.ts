import { pool } from "../pool.js";
import type { GuardrailResult, RunStatus, RunType } from "../../domain/schemas.js";
import type { CategorizedAgentRun } from "../../services/qualityMetrics.js";
import type { OrgContext } from "../../domain/orgContext.js";

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
export async function insertAgentRun(ctx: OrgContext, run: NewAgentRun): Promise<void> {
  await pool.query(
    `INSERT INTO agent_runs
       (run_id, ticket_id, run_type, status, retrieved_doc_ids, tool_calls,
        guardrail_results, rejected_output, model_provider, model_name, latency_ms, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
      ctx.org_id,
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
export async function getCategorizedDraftRuns(ctx: OrgContext): Promise<CategorizedAgentRun[]> {
  const { rows } = await pool.query(
    `SELECT t.triage->>'category' AS category, ar.status
     FROM agent_runs ar
     JOIN tickets t ON ar.ticket_id = t.ticket_id
     WHERE ar.run_type = 'draft_reply' AND t.triage IS NOT NULL AND ar.org_id = $1`,
    [ctx.org_id]
  );
  return rows;
}

export async function getAgentRunById(ctx: OrgContext, runId: string): Promise<AgentRunRow | null> {
  const { rows } = await pool.query(
    `SELECT run_id, ticket_id, run_type, status, retrieved_doc_ids, tool_calls,
            guardrail_results, rejected_output, model_provider, model_name,
            latency_ms, created_at::text
     FROM agent_runs WHERE run_id = $1 AND org_id = $2`,
    [runId, ctx.org_id]
  );
  return rows[0] ?? null;
}

export interface AgentRunListRow {
  run_id: string;
  ticket_id: string | null;
  run_type: string;
  status: string;
  guardrail_results: unknown;
  model_provider: string | null;
  model_name: string | null;
  latency_ms: number | null;
  created_at: string;
  ticket_subject: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  order_id: string | null;
  order_status: string | null;
  order_total: string | null;
  order_currency: string | null;
}

// New audit-trail listing (frontend AuditTrail.tsx): every agent_runs row
// for the caller's own org, most recent first, joined out to its ticket's
// customer + order so a reviewer can see who/what a run was actually
// about without a second lookup — the single-run GET /agent-runs/:runId
// (getAgentRunById above) already covers full per-run detail (tool_calls,
// rejected_output, retrieved_doc_ids), so this intentionally omits those
// heavier fields to keep a many-row list light. LEFT JOINs throughout:
// ticket_id is nullable on agent_runs, and a ticket's order_id is nullable
// too (LLD §2), so a run with no ticket or a ticket with no order still
// returns a row rather than being silently dropped.
export async function listAgentRuns(ctx: OrgContext, limit = 200): Promise<AgentRunListRow[]> {
  const { rows } = await pool.query(
    `SELECT
       ar.run_id, ar.ticket_id, ar.run_type, ar.status, ar.guardrail_results,
       ar.model_provider, ar.model_name, ar.latency_ms, ar.created_at::text,
       t.subject AS ticket_subject,
       t.customer_id,
       c.name AS customer_name,
       c.email AS customer_email,
       t.order_id,
       o.status AS order_status,
       o.total::text AS order_total,
       o.currency AS order_currency
     FROM agent_runs ar
     LEFT JOIN tickets t ON ar.ticket_id = t.ticket_id
     LEFT JOIN customers c ON t.customer_id = c.customer_id
     LEFT JOIN orders o ON t.order_id = o.order_id
     WHERE ar.org_id = $1
     ORDER BY ar.created_at DESC
     LIMIT $2`,
    [ctx.org_id, limit]
  );
  return rows;
}
