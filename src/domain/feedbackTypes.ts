import { z } from "zod";

// V2-3 (LLD_v2 §4): POST /drafts/:id/feedback. reviewer comes from the JWT,
// never the body — matches the reviewer_id-from-JWT convention already used
// by ApprovalDecisionRequest (src/domain/toolActionTypes.ts).
export const SubmitFeedbackRequest = z.object({
  rating: z.number().int().min(1).max(5),
  reason: z.string().optional(),
  corrected_response: z.string().optional(),
});
export type SubmitFeedbackRequest = z.infer<typeof SubmitFeedbackRequest>;
