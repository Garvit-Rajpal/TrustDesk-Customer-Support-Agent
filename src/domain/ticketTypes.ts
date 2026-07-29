import { z } from "zod";

// LLD §4.5: POST /tickets — create (demo).
export const CreateTicketRequest = z.object({
  customer_id: z.string().min(1),
  order_id: z.string().min(1).optional(),
  channel: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type CreateTicketRequest = z.infer<typeof CreateTicketRequest>;

// V2-4 (LLD_v2 §5): POST /tickets/:id/messages/simulate-inbound — demo/test
// control standing in for a real inbound channel (v3).
export const SimulateInboundRequest = z.object({
  body: z.string().min(1),
});
export type SimulateInboundRequest = z.infer<typeof SimulateInboundRequest>;

// V3-4 (LLD_v3 §3): POST /tickets/:id/messages/reply — human takeover.
export const ManualReplyRequest = z.object({
  body: z.string().min(1),
});
export type ManualReplyRequest = z.infer<typeof ManualReplyRequest>;
