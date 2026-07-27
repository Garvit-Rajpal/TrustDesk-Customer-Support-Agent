import { z } from "zod";

// LLD §4.8: payload is opaque to the schema layer — its required keys are
// catalog-defined (tool_catalog.required_fields), checked deterministically
// in ToolActionService, not by zod.
export const CreateToolActionRequest = z.object({
  ticket_id: z.string().min(1),
  tool_name: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type CreateToolActionRequest = z.infer<typeof CreateToolActionRequest>;

export const ApprovalDecisionRequest = z.object({
  reason: z.string().min(1),
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>;
