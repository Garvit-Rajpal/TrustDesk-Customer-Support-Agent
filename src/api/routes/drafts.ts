import { Router } from "express";
import { SubmitFeedbackRequest } from "../../domain/feedbackTypes.js";
import { newFeedbackId } from "../../domain/ids.js";
import { getDraftById } from "../../db/repos/draftsRepo.js";
import { getTicketById } from "../../db/repos/ticketsRepo.js";
import { upsertFeedback } from "../../db/repos/feedbackRepo.js";
import { sendDraft } from "../../services/ticketThread.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const draftsRouter = Router();

// V2-3 (LLD_v2 §4/§9): reviewer comes from the JWT, never the body.
// Upserts on (draft_id, reviewer_id) — a second submission from the same
// reviewer updates their existing feedback instead of creating a duplicate.
draftsRouter.post("/:id/feedback", requirePermission("feedback:submit"), async (req, res, next) => {
  try {
    const parsed = SubmitFeedbackRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "Invalid feedback payload", parsed.error.flatten());
      return;
    }

    const ctx = req.orgContext!;
    const draft = await getDraftById(ctx, req.params.id);
    if (!draft) {
      sendError(res, "NOT_FOUND", `Draft ${req.params.id} not found`);
      return;
    }

    const { row, created } = await upsertFeedback(ctx, {
      feedback_id: newFeedbackId(),
      ticket_id: draft.ticket_id,
      draft_id: draft.draft_id,
      reviewer_id: req.user!.sub,
      rating: parsed.data.rating,
      reason: parsed.data.reason,
      corrected_response: parsed.data.corrected_response,
    });

    res.status(created ? 201 : 200).json({ data: row });
  } catch (err) {
    next(err);
  }
});

// V2-4 (LLD_v2 §5): appends an outbound message from the draft, moves the
// draft to 'sent', and the ticket to awaiting_customer. Illegal from the
// ticket's current status (e.g. it's already awaiting a reply) → 409.
draftsRouter.post("/:id/send", requirePermission("drafts:send"), async (req, res, next) => {
  try {
    const ctx = req.orgContext!;
    const draft = await getDraftById(ctx, req.params.id);
    if (!draft) {
      sendError(res, "NOT_FOUND", `Draft ${req.params.id} not found`);
      return;
    }
    const ticket = await getTicketById(ctx, draft.ticket_id);
    if (!ticket) {
      sendError(res, "NOT_FOUND", `Ticket ${draft.ticket_id} not found`);
      return;
    }

    const outcome = await sendDraft(ctx, ticket, draft, req.user!.sub);
    if (outcome.kind === "illegal_transition") {
      sendError(
        res,
        "CONFLICT",
        `Ticket is "${outcome.from}" — a draft can only be sent while the ticket is "in_progress"`
      );
      return;
    }
    res.status(200).json({ data: { draft_id: draft.draft_id, ticket_id: ticket.ticket_id, message: outcome.message } });
  } catch (err) {
    next(err);
  }
});
