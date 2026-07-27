import { pool } from "../pool.js";
import type { ActionStatus } from "../../domain/schemas.js";

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

export async function insertToolAction(action: NewToolAction): Promise<ToolActionRow> {
  const { rows } = await pool.query(
    `INSERT INTO tool_actions
       (action_id, ticket_id, tool_name, payload, risk_level, requires_human_approval, status, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    ]
  );
  return rows[0];
}

export async function getToolActionById(actionId: string): Promise<ToolActionRow | null> {
  const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM tool_actions WHERE action_id = $1`, [
    actionId,
  ]);
  return rows[0] ?? null;
}

export async function getToolActionByIdempotencyKey(key: string): Promise<ToolActionRow | null> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM tool_actions WHERE idempotency_key = $1`,
    [key]
  );
  return rows[0] ?? null;
}

export async function updateToolActionStatus(
  actionId: string,
  status: ActionStatus
): Promise<ToolActionRow> {
  const { rows } = await pool.query(
    `UPDATE tool_actions SET status = $2, updated_at = now() WHERE action_id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [actionId, status]
  );
  return rows[0];
}

export async function updateExecutionResult(
  actionId: string,
  status: ActionStatus,
  executionResult: unknown
): Promise<ToolActionRow> {
  const { rows } = await pool.query(
    `UPDATE tool_actions SET status = $2, execution_result = $3, updated_at = now() WHERE action_id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [actionId, status, JSON.stringify(executionResult)]
  );
  return rows[0];
}
