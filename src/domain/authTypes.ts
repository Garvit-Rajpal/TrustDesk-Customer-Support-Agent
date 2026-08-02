import { z } from "zod";

export const Role = z.enum(["agent", "manager", "admin"]);
export type Role = z.infer<typeof Role>;

export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// V2-2 (LLD_v2 §3, ADR-9): "Admin-only POST /users/invite replaces 'no
// signup' as the account-creation path." Still no public signup — this
// route itself is admin-only (requirePermission("users:invite")).
export const InviteUserRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
  display_name: z.string().min(1),
  role: Role.default("agent"),
});
export type InviteUserRequest = z.infer<typeof InviteUserRequest>;

// JWT claims (LLD §4.1: HS256, 8h expiry, claims { sub, name, role }).
// V2-5 (LLD_v2 §6): "JWT adds org_id; login response includes org."
export interface TokenClaims {
  sub: string;
  name: string;
  role: string;
  org_id: string;
}

// W17 (LLD_v4 §7, HLD_v4 ADR-23): a deliberately minimal, non-account token
// minted by POST /customer-auth/verify's ownership check, not a password
// login. No `role` field — requirePermission() rejects it on every existing
// agent/admin route by construction (roleHasPermission(undefined, ...) is
// always false), not by an added check. A zod schema (not just the TS type)
// backs verifyCustomerToken() below so a *decoded* agent TokenClaims payload
// (which has no `kind`) is explicitly rejected on /portal/* rather than
// silently passing through with undefined customer_id/org_id.
export const CustomerTokenClaims = z.object({
  customer_id: z.string(),
  org_id: z.string(),
  ticket_id: z.string().optional(),
  kind: z.literal("customer"),
});
export type CustomerTokenClaims = z.infer<typeof CustomerTokenClaims>;

// W17 (LLD_v4 §7): POST /customer-auth/verify's request body. LLD_v4 §7
// describes this as "a zod discriminated union" of `{org_slug, email,
// order_id}` vs `{org_slug, email, ticket_id}` — but neither variant carries
// a shared literal field to discriminate on (zod's discriminatedUnion()
// requires one), so it's implemented here as a single object with an
// exactly-one-of refinement instead, which accepts the identical two request
// shapes and rejects a body with both or neither.
export const CustomerVerifyRequest = z
  .object({
    org_slug: z.string().min(1),
    email: z.string().email(),
    order_id: z.string().optional(),
    ticket_id: z.string().optional(),
  })
  .refine((data) => (data.order_id ? 1 : 0) + (data.ticket_id ? 1 : 0) === 1, {
    message: "Exactly one of order_id or ticket_id must be provided",
  });
export type CustomerVerifyRequest = z.infer<typeof CustomerVerifyRequest>;

// V5-19 (LLD_v5 §6, HLD_v5 ADR-29): POST /customer-auth/magic-link/request's
// body. ticket_id is optional (unlike CustomerVerifyRequest's exactly-one-of
// order_id/ticket_id) — a magic link can scope to a ticket if the customer
// followed one in from a specific thread, but a bare org+email is enough to
// request a link at all.
export const MagicLinkRequest = z.object({
  org_slug: z.string().min(1),
  email: z.string().email(),
  ticket_id: z.string().optional(),
});
export type MagicLinkRequest = z.infer<typeof MagicLinkRequest>;

// V5-20: POST /customer-auth/magic-link/consume's body — just the opaque
// token from the emailed link.
export const MagicLinkConsumeRequest = z.object({
  token: z.string().min(1),
});
export type MagicLinkConsumeRequest = z.infer<typeof MagicLinkConsumeRequest>;
