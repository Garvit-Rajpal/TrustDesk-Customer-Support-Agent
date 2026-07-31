import type { NextFunction, Request, Response } from "express";
import { verifyCustomerToken } from "../../services/tokens.js";
import { sendError } from "../errorEnvelope.js";

// W17 (LLD_v4 §7): guards new /portal/*-facing routes only — never mixed
// into the existing authMiddleware/requirePermission() chain. Reads the
// CustomerToken from Authorization: Bearer (the one REST route,
// POST /customer-auth/verify's callers) or the WS handshake query string
// (?token=, the same accommodation authMiddleware makes for SSE's
// EventSource, which also can't set custom headers).
export function customerAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const headerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const token = headerToken ?? queryToken;

  if (!token) {
    sendError(res, "UNAUTHENTICATED", "Missing customer token");
    return;
  }

  try {
    const claims = verifyCustomerToken(token);
    req.customerContext = { customer_id: claims.customer_id, org_id: claims.org_id, ticket_id: claims.ticket_id };
    next();
  } catch {
    sendError(res, "UNAUTHENTICATED", "Invalid or expired customer token");
  }
}
