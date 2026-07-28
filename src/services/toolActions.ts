// ToolActionService (HLD §4.3, LLD §4.8-4.10). Every rule enforced here is
// deterministic and catalog-driven — requires_human_approval in particular
// comes ONLY from tool_catalog, never from the caller's payload or any
// model output (HLD invariant #1; this is what defeats tkt_9006's "hide it
// from the reviewer" injection even if it reached this far).
import { nanoid } from "nanoid";
import type { Ticket } from "../domain/entities.js";
import type { ActionStatus } from "../domain/schemas.js";
import { TriageResult } from "../domain/schemas.js";
import { newActionId, newApprovalId } from "../domain/ids.js";
import { getToolCatalogEntry } from "../db/repos/toolCatalogRepo.js";
import {
  getActiveActionForTicket,
  getToolActionById,
  getToolActionByIdempotencyKey,
  insertToolAction,
  updateExecutionResult,
  updateToolActionStatus,
  type ToolActionRow,
} from "../db/repos/toolActionsRepo.js";
import { insertApproval } from "../db/repos/approvalsRepo.js";
import { computeEligibilityFacts } from "./eligibility.js";
import { getCustomerById } from "../db/repos/customersRepo.js";
import { getOrderById } from "../db/repos/ordersRepo.js";
import { getTicketById } from "../db/repos/ticketsRepo.js";

// ---- request (LLD §4.8 validation ladder) ----------------------------

export type RequestActionOutcome =
  | { kind: "invalid"; message: string }
  | { kind: "created"; action: ToolActionRow }
  | { kind: "replayed"; action: ToolActionRow };

export async function requestToolAction(
  ticket: Ticket,
  toolName: string,
  payload: Record<string, unknown>
): Promise<RequestActionOutcome> {
  // 1. tool exists in catalog
  const tool = await getToolCatalogEntry(toolName);
  if (!tool) {
    return { kind: "invalid", message: `Unknown tool "${toolName}"` };
  }

  // 2. all required_fields present
  const missing = tool.required_fields.filter(
    (field) => payload[field] === undefined || payload[field] === null || payload[field] === ""
  );
  if (missing.length > 0) {
    return { kind: "invalid", message: `Missing required fields: ${missing.join(", ")}` };
  }

  // 3. ticket triaged and triage.category in allowed_categories
  if (!ticket.triage) {
    return { kind: "invalid", message: "Ticket must be triaged before an action can be requested" };
  }
  const triage = TriageResult.parse(ticket.triage);
  if (!tool.allowed_categories.includes(triage.category)) {
    return {
      kind: "invalid",
      message: `Tool "${toolName}" is not allowed for category "${triage.category}"`,
    };
  }

  // 4. amount within max_amount_inr, when the catalog defines a limit
  if (tool.max_amount_inr != null) {
    const amount = payload.amount;
    if (typeof amount !== "number") {
      return { kind: "invalid", message: `payload.amount must be a number for "${toolName}"` };
    }
    if (amount > tool.max_amount_inr) {
      return {
        kind: "invalid",
        message: `amount ${amount} exceeds max_amount_inr ${tool.max_amount_inr} for "${toolName}"`,
      };
    }
  }

  // 5. idempotency: unseen key creates; seen key replays the stored result,
  // never re-executes (LLD §4.8).
  const idempotencyKey = String(payload.idempotency_key);
  const existing = await getToolActionByIdempotencyKey(idempotencyKey);
  if (existing) {
    return { kind: "replayed", action: existing };
  }

  // 6. One active action per ticket (product decision, not in LLD): once
  // anything is approved/executed for this ticket, block a genuinely new
  // request — a customer can't end up with both a replacement AND a refund
  // for the same issue. Actions still sitting in approval_required don't
  // count yet; the matching guard at approve-time (below) is what prevents
  // two simultaneously-requested actions from both going through.
  const activeConflict = await getActiveActionForTicket(ticket.ticket_id);
  if (activeConflict) {
    return {
      kind: "invalid",
      message: `Ticket ${ticket.ticket_id} already has an active action (${activeConflict.tool_name}, ${activeConflict.action_id}, status ${activeConflict.status}) — no further actions allowed`,
    };
  }

  const status: ActionStatus = tool.requires_human_approval ? "approval_required" : "approved";

  try {
    const action = await insertToolAction({
      action_id: newActionId(),
      ticket_id: ticket.ticket_id,
      tool_name: toolName,
      payload,
      risk_level: tool.risk_level,
      requires_human_approval: tool.requires_human_approval,
      status,
      idempotency_key: idempotencyKey,
    });
    return { kind: "created", action };
  } catch (err) {
    // Race: two concurrent requests with the same key. The UNIQUE
    // constraint rejects the loser; treat it as a replay rather than a 500.
    if (isUniqueViolation(err)) {
      const raced = await getToolActionByIdempotencyKey(idempotencyKey);
      if (raced) return { kind: "replayed", action: raced };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// ---- approve / reject (LLD §4.9) --------------------------------------

export type DecisionOutcome =
  | { kind: "not_found" }
  | { kind: "illegal_transition"; from: ActionStatus }
  | { kind: "ticket_locked"; conflictingAction: ToolActionRow }
  | { kind: "ok"; action: ToolActionRow };

export async function decideToolAction(
  actionId: string,
  reviewerId: string,
  reason: string,
  decision: "approved" | "rejected"
): Promise<DecisionOutcome> {
  const action = await getToolActionById(actionId);
  if (!action) return { kind: "not_found" };
  // Legal only from approval_required (LLD §4.9). Rejection is terminal —
  // no auto-retry loop (HLD §4.3).
  if (action.status !== "approval_required") {
    return { kind: "illegal_transition", from: action.status };
  }

  // One active action per ticket: two actions can both sit in
  // approval_required (request-time only blocks once one is already
  // approved/executed), but only the first one approved may proceed.
  // Rejection never triggers this — it can't create a second "resolved"
  // state, so it always skips this check.
  if (decision === "approved") {
    const activeConflict = await getActiveActionForTicket(action.ticket_id, actionId);
    if (activeConflict) {
      return { kind: "ticket_locked", conflictingAction: activeConflict };
    }
  }

  await insertApproval({
    approval_id: newApprovalId(),
    action_id: actionId,
    reviewer_id: reviewerId,
    decision,
    reason,
  });
  const updated = await updateToolActionStatus(actionId, decision);
  return { kind: "ok", action: updated };
}

// ---- execute (LLD §4.10) -----------------------------------------------

export type ExecuteOutcome =
  | { kind: "not_found" }
  | { kind: "illegal_transition"; from: ActionStatus }
  | { kind: "replayed"; action: ToolActionRow }
  | { kind: "executed"; action: ToolActionRow }
  | { kind: "failed"; action: ToolActionRow };

// Tools whose effect is contingent on the eligibility facts computed for
// the draft (LLD §4.2/§4.10: "re-runs eligibility validation... facts were
// first computed pre-draft"). Only these two are gated at execute time —
// the other catalog tools (carrier investigation, coupon, escalation,
// account lock) have no return/warranty window to violate.
const ELIGIBILITY_GATED_TOOLS = new Set(["create_replacement_order", "start_refund_review"]);

export async function executeToolAction(actionId: string): Promise<ExecuteOutcome> {
  const action = await getToolActionById(actionId);
  if (!action) return { kind: "not_found" };

  if (action.status === "executed") {
    return { kind: "replayed", action };
  }
  if (action.status !== "approved") {
    return { kind: "illegal_transition", from: action.status };
  }

  if (ELIGIBILITY_GATED_TOOLS.has(action.tool_name)) {
    const ticket = await getTicketById(action.ticket_id);
    const customer = await getCustomerById(ticket!.customer_id);
    const order = ticket!.order_id ? await getOrderById(ticket!.order_id) : null;
    const facts = computeEligibilityFacts(ticket!.created_at, order, customer!);

    const eligible = facts.return_window_eligible === true || facts.warranty_active === true;
    if (!eligible) {
      const updated = await updateExecutionResult(actionId, "failed", {
        error: "Eligibility re-validation failed at execute time: return window and warranty both expired",
        facts,
      });
      return { kind: "failed", action: updated };
    }
  }

  const result = mockExecute(action.tool_name, action.payload);
  const updated = await updateExecutionResult(actionId, "executed", result);
  return { kind: "executed", action: updated };
}

// Deterministic mock execution effect per tool (this is a demo/eval
// environment — no real payment/carrier/email systems are integrated).
function mockExecute(toolName: string, payload: Record<string, unknown>): Record<string, unknown> {
  switch (toolName) {
    case "create_replacement_order":
      return { replacement_order_id: `ro_${nanoid()}`, order_id: payload.order_id, sku: payload.sku };
    case "start_refund_review":
      return { refund_review_id: `rr_${nanoid()}`, order_id: payload.order_id, amount: payload.amount };
    case "issue_coupon":
      return { coupon_code: `CPN-${nanoid(8).toUpperCase()}`, amount: payload.amount };
    case "open_carrier_investigation":
      return { investigation_id: `inv_${nanoid()}`, tracking_number: payload.tracking_number };
    case "escalate_to_human":
      return { escalated: true, queue: payload.queue };
    case "lock_account":
      return { locked: true, customer_id: payload.customer_id };
    default:
      return { note: "no mock execution effect defined for this tool" };
  }
}
