import { pool } from "../pool.js";
import type { ApprovalDecision } from "../../domain/schemas.js";
import type { CategorizedApproval } from "../../services/qualityMetrics.js";

export interface NewApproval {
  approval_id: string;
  action_id: string;
  reviewer_id: string;
  decision: ApprovalDecision;
  reason: string;
}

export async function insertApproval(approval: NewApproval): Promise<void> {
  await pool.query(
    `INSERT INTO approvals (approval_id, action_id, reviewer_id, decision, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [approval.approval_id, approval.action_id, approval.reviewer_id, approval.decision, approval.reason]
  );
}

// V2-3 (LLD_v2 §4): tool-action approvals (approvals.action_id is set — the
// only kind that exists today, draft-level approvals aren't wired up yet)
// joined out to their ticket's triage category, for
// GET /metrics/agent-quality's action_approval_rate.
export async function getCategorizedApprovals(): Promise<CategorizedApproval[]> {
  const { rows } = await pool.query(`
    SELECT t.triage->>'category' AS category, ap.decision
    FROM approvals ap
    JOIN tool_actions ta ON ap.action_id = ta.action_id
    JOIN tickets t ON ta.ticket_id = t.ticket_id
    WHERE ap.action_id IS NOT NULL AND t.triage IS NOT NULL
  `);
  return rows;
}
