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
