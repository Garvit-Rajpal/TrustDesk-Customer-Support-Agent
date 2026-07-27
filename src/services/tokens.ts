import jwt from "jsonwebtoken";
import type { TokenClaims } from "../domain/authTypes.js";

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

// ADR-4 / LLD §4.1: HS256, 8h expiry, claims { sub, name, role }. The JWT
// `sub` becomes reviewer_id on approvals (HLD §3 ApprovalService).
export function signToken(claims: TokenClaims): string {
  return jwt.sign(claims, secret(), { algorithm: "HS256", expiresIn: "8h" });
}

export function verifyToken(token: string): TokenClaims {
  const decoded = jwt.verify(token, secret(), { algorithms: ["HS256"] });
  if (typeof decoded === "string") throw new Error("Unexpected token payload");
  return decoded as unknown as TokenClaims;
}
