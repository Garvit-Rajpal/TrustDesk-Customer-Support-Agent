import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../../services/tokens.js";
import { sendError } from "../errorEnvelope.js";

// ADR-4: verifies the JWT on every route it guards; req.user.sub is later
// recorded as reviewer_id on approvals. No customer auth exists — this
// middleware only ever protects internal agent/manager routes.
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const headerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  // Browser EventSource (ADR-8's SSE mechanism) cannot set custom headers,
  // so the RunStepper's live/replay stream is the one caller allowed to
  // authenticate via ?token= instead. Every other route still requires the
  // Authorization header.
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = headerToken ?? queryToken;

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
