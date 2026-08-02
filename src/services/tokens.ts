import jwt, { type SignOptions } from "jsonwebtoken";
import { CustomerTokenClaims, type TokenClaims } from "../domain/authTypes.js";

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

// W17 (LLD_v4 §7): same JWT_SECRET/HS256 as the agent token, sibling
// sign/verify pair. Shorter expiry (1h, re-verify to renew) since this token
// is minted from an unauthenticated ownership check, not a password login.
// V5-19 (LLD_v5 §6, HLD_v5 ADR-29): optional `opts.expiresIn`, defaulting to
// the existing "1h" when omitted — /customer-auth/verify's call site passes
// no second argument, so its behavior stays byte-identical to v4.
// /customer-auth/magic-link/consume is the only call site that passes
// { expiresIn: "30d" }, since out-of-band inbox access is a stronger proof
// of identity than a single form submission.
export function signCustomerToken(
  claims: CustomerTokenClaims,
  opts?: { expiresIn?: SignOptions["expiresIn"] }
): string {
  return jwt.sign(claims, secret(), { algorithm: "HS256", expiresIn: opts?.expiresIn ?? "1h" });
}

// Validates against the CustomerTokenClaims zod schema (not just a type
// cast) so a decoded agent TokenClaims payload — same secret, no `kind`
// field — is rejected here rather than silently passing through.
export function verifyCustomerToken(token: string): CustomerTokenClaims {
  const decoded = jwt.verify(token, secret(), { algorithms: ["HS256"] });
  if (typeof decoded === "string") throw new Error("Unexpected token payload");
  return CustomerTokenClaims.parse(decoded);
}
