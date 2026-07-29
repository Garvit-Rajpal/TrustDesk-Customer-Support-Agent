import { Router, type Request, type Response } from "express";
import { CreateToolActionRequest, ApprovalDecisionRequest } from "../../domain/toolActionTypes.js";
import { getTicketById } from "../../db/repos/ticketsRepo.js";
import { decideToolAction, executeToolAction, requestToolAction } from "../../services/toolActions.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const toolActionsRouter = Router();

// LLD §4.8: validation ladder, idempotent by payload.idempotency_key.
toolActionsRouter.post("/", requirePermission("tool_actions:request"), async (req, res, next) => {
  try {
    const parsed = CreateToolActionRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "Invalid tool-action request", parsed.error.flatten());
      return;
    }
    const { ticket_id, tool_name, payload } = parsed.data;

    const ticket = await getTicketById(ticket_id);
    if (!ticket) {
      sendError(res, "NOT_FOUND", `Ticket ${ticket_id} not found`);
      return;
    }

    const outcome = await requestToolAction(ticket, tool_name, payload);

    if (outcome.kind === "invalid") {
      sendError(res, "VALIDATION_ERROR", outcome.message);
      return;
    }
    if (outcome.kind === "replayed") {
      res.status(200).json({
        data: { action_id: outcome.action.action_id, status: outcome.action.status, replayed: true },
      });
      return;
    }
    res.status(201).json({ data: { action_id: outcome.action.action_id, status: outcome.action.status } });
  } catch (err) {
    next(err);
  }
});

// LLD §4.9: legal only from approval_required; reviewer_id from the JWT.
toolActionsRouter.post("/:id/approve", requirePermission("tool_actions:approve"), async (req, res, next) => {
  try {
    await handleDecision(req.params.id, req, res, "approved");
  } catch (err) {
    next(err);
  }
});

toolActionsRouter.post("/:id/reject", requirePermission("tool_actions:approve"), async (req, res, next) => {
  try {
    await handleDecision(req.params.id, req, res, "rejected");
  } catch (err) {
    next(err);
  }
});

async function handleDecision(
  actionId: string,
  req: Request,
  res: Response,
  decision: "approved" | "rejected"
): Promise<void> {
  const parsed = ApprovalDecisionRequest.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, "VALIDATION_ERROR", "reason is required", parsed.error.flatten());
    return;
  }
  const reviewerId = req.user!.sub;

  const outcome = await decideToolAction(actionId, reviewerId, parsed.data.reason, decision);

  if (outcome.kind === "not_found") {
    sendError(res, "NOT_FOUND", `Tool action ${actionId} not found`);
    return;
  }
  if (outcome.kind === "illegal_transition") {
    sendError(res, "CONFLICT", `Tool action is "${outcome.from}", not "approval_required"`);
    return;
  }
  if (outcome.kind === "ticket_locked") {
    sendError(
      res,
      "CONFLICT",
      `Ticket already has an active action (${outcome.conflictingAction.tool_name}, ${outcome.conflictingAction.action_id}) — only one active action per ticket is allowed`
    );
    return;
  }
  res.status(200).json({ data: { action_id: outcome.action.action_id, status: outcome.action.status } });
}

// LLD §4.10: legal only from approved; re-executing an executed action replays.
toolActionsRouter.post("/:id/execute", requirePermission("tool_actions:approve"), async (req, res, next) => {
  try {
    const outcome = await executeToolAction(req.params.id);

    if (outcome.kind === "not_found") {
      sendError(res, "NOT_FOUND", `Tool action ${req.params.id} not found`);
      return;
    }
    if (outcome.kind === "illegal_transition") {
      sendError(res, "CONFLICT", `Tool action is "${outcome.from}", not "approved"`);
      return;
    }
    res.status(200).json({
      data: {
        action_id: outcome.action.action_id,
        status: outcome.action.status,
        execution_result: outcome.action.execution_result,
        ...(outcome.kind === "replayed" ? { replayed: true } : {}),
      },
    });
  } catch (err) {
    next(err);
  }
});
