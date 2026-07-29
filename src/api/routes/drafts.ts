import { Router } from "express";
import { SubmitFeedbackRequest } from "../../domain/feedbackTypes.js";
import { newFeedbackId } from "../../domain/ids.js";
import { getDraftById } from "../../db/repos/draftsRepo.js";
import { upsertFeedback } from "../../db/repos/feedbackRepo.js";
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

    const draft = await getDraftById(req.params.id);
    if (!draft) {
      sendError(res, "NOT_FOUND", `Draft ${req.params.id} not found`);
      return;
    }

    const { row, created } = await upsertFeedback({
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
