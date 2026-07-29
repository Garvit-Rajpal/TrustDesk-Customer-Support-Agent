import { z } from "zod";

// V2-5 follow-up: POST /customers. There was no customer-creation path in
// v1 (customers only ever came from seed data — "no customer auth exists,
// no signup endpoint" per HLD). That was fine with a single seeded
// org_default, but a freshly onboarded org (V2-5) starts with zero
// customers and therefore couldn't create any tickets at all. This is a
// deliberate, scoped extension of that v1 assumption, not a violation of
// it — there's still no *customer-facing* auth/signup; this is an internal
// agent-facing "register a customer record" action, same trust tier as
// creating a ticket.
export const CreateCustomerRequest = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  tier: z.string().min(1).default("standard"),
  country: z.string().min(1),
  verified: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
});
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequest>;
