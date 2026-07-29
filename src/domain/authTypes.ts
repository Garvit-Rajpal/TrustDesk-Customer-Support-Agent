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
