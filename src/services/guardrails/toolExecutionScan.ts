// Guardrail tool-execution-time layer (V4-17, LLD_v4 §6, HLD_v4 ADR-22).
// Re-runs the same catalog-driven constraint checks outputScan.ts's
// checkActionValidity already performs at draft time (tool still in
// catalog, payload still has catalog-required fields), plus one
// execute-time-only fact: the ticket hasn't since moved to a terminal
// status. Time passes between approval and execution — this is what an
// approver actually re-affirms is still true right before the effect fires.
import type { OrgContext } from "../../domain/orgContext.js";
import { GuardrailResult } from "../../domain/schemas.js";
import type { ToolActionRow } from "../../db/repos/toolActionsRepo.js";
import { getToolCatalogEntry } from "../../db/repos/toolCatalogRepo.js";
import { getTicketById } from "../../db/repos/ticketsRepo.js";

const TERMINAL_STATUSES = new Set(["resolved", "closed"]);

export async function toolExecutionScan(ctx: OrgContext, action: ToolActionRow): Promise<GuardrailResult> {
  const reasons: string[] = [];

  const tool = await getToolCatalogEntry(action.tool_name);
  if (!tool) {
    reasons.push(`${action.tool_name}: not in catalog`);
  } else {
    const missing = tool.required_fields.filter(
      (field) => action.payload[field] === undefined || action.payload[field] === null || action.payload[field] === ""
    );
    if (missing.length > 0) {
      reasons.push(`missing required fields: ${missing.join(", ")}`);
    }
  }

  const ticket = await getTicketById(ctx, action.ticket_id);
  if (ticket && TERMINAL_STATUSES.has(ticket.status)) {
    reasons.push(`ticket ${action.ticket_id} is already ${ticket.status}`);
  }

  return GuardrailResult.parse({
    layer: "tool_execution",
    check: "execute_time_revalidation",
    passed: reasons.length === 0,
    detail: reasons.length > 0 ? reasons.join("; ") : undefined,
  });
}
