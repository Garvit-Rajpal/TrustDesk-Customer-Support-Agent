import { z } from "zod";

export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// JWT claims (LLD §4.1: HS256, 8h expiry, claims { sub, name, role }).
export interface TokenClaims {
  sub: string;
  name: string;
  role: string;
}
