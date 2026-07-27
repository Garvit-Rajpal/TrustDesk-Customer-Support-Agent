import { pool } from "../pool.js";
import type { ApprovalDecision } from "../../domain/schemas.js";

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
