import { pool } from "../pool.js";
import type { ActionStatus } from "../../domain/schemas.js";
import type { OrgContext } from "../../domain/orgContext.js";

export interface NewToolAction {
  action_id: string;
  ticket_id: string;
  tool_name: string;
  payload: Record<string, unknown>;
  risk_level: string;
  requires_human_approval: boolean;
  status: ActionStatus;
  idempotency_key: string;
}

export interface ToolActionRow {
  action_id: string;
  ticket_id: string;
  tool_name: string;
  payload: Record<string, unknown>;
  risk_level: string;
  requires_human_approval: boolean;
  status: ActionStatus;
  idempotency_key: string;
  execution_result: unknown;
  created_at: string;
  updated_at: string;
}

const SELECT_COLUMNS = `action_id, ticket_id, tool_name, payload, risk_level, requires_human_approval,
  status, idempotency_key, execution_result, created_at::text, updated_at::text`;

export async function insertToolAction(ctx: OrgContext, action: NewToolAction): Promise<ToolActionRow> {
  const { rows } = await pool.query(
    `INSERT INTO tool_actions
       (action_id, ticket_id, tool_name, payload, risk_level, requires_human_approval, status, idempotency_key, org_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${SELECT_COLUMNS}`,
    [
      action.action_id,
      action.ticket_id,
      action.tool_name,
      JSON.stringify(action.payload),
      action.risk_level,
      action.requires_human_approval,
      action.status,
      action.idempotency_key,
      ctx.org_id,
    ]
  );
  return rows[0];
}

export async function getToolActionById(ctx: OrgContext, actionId: string): Promise<ToolActionRow | null> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM tool_actions WHERE action_id = $1 AND org_id = $2`,
    [actionId, ctx.org_id]
  );
  return rows[0] ?? null;
}

// Idempotency keys are scoped per-org (a caller-supplied key), same as
// every other lookup — two orgs happening to pick the same key must never
// collide or leak each other's action.
export async function getToolActionByIdempotencyKey(
  ctx: OrgContext,
  key: string
): Promise<ToolActionRow | null> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM tool_actions WHERE idempotency_key = $1 AND org_id = $2`,
    [key, ctx.org_id]
  );
  return rows[0] ?? null;
}

// One active (approved or executed) resolution action per ticket, by
// product decision: once anything is approved/executed for a ticket, no
// other action for that same ticket can be requested or approved — e.g. a
// customer can't end up with both a replacement AND a refund for the same
// damaged item. `excludeActionId` lets the approve-time check ignore the
// action being decided on.
export async function getActiveActionForTicket(
  ctx: OrgContext,
  ticketId: string,
  excludeActionId?: string
): Promise<ToolActionRow | null> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM tool_actions
     WHERE ticket_id = $1 AND org_id = $2 AND status IN ('approved', 'executed')
       AND ($3::text IS NULL OR action_id != $3)
     LIMIT 1`,
    [ticketId, ctx.org_id, excludeActionId ?? null]
  );
  return rows[0] ?? null;
}

export async function updateToolActionStatus(
  ctx: OrgContext,
  actionId: string,
  status: ActionStatus
): Promise<ToolActionRow> {
  const { rows } = await pool.query(
    `UPDATE tool_actions SET status = $3, updated_at = now() WHERE action_id = $1 AND org_id = $2
     RETURNING ${SELECT_COLUMNS}`,
    [actionId, ctx.org_id, status]
  );
  return rows[0];
}

export async function updateExecutionResult(
  ctx: OrgContext,
  actionId: string,
  status: ActionStatus,
  executionResult: unknown
): Promise<ToolActionRow> {
  const { rows } = await pool.query(
    `UPDATE tool_actions SET status = $3, execution_result = $4, updated_at = now() WHERE action_id = $1 AND org_id = $2
     RETURNING ${SELECT_COLUMNS}`,
    [actionId, ctx.org_id, status, JSON.stringify(executionResult)]
  );
  return rows[0];
}
