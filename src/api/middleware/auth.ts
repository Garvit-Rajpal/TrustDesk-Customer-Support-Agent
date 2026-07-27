import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../../services/tokens.js";
import { sendError } from "../errorEnvelope.js";

// ADR-4: verifies the JWT on every route it guards; req.user.sub is later
// recorded as reviewer_id on approvals. No customer auth exists — this
// middleware only ever protects internal agent/manager routes.
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;

  if (!token) {
    sendError(res, "UNAUTHENTICATED", "Missing bearer token");
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    sendError(res, "UNAUTHENTICATED", "Invalid or expired token");
  }
}
