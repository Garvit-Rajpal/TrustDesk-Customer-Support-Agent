import type { NextFunction, Request, Response } from "express";

// V2-5 (LLD_v2 §6): "Tenancy middleware builds the context from the JWT."
// Mounted after authMiddleware on every tenant-scoped router — req.user is
// always set by the time this runs. This is the one place org_id is lifted
// out of the JWT into the OrgContext every repo method requires; route
// handlers never read req.user.org_id directly.
export function tenancyMiddleware(req: Request, _res: Response, next: NextFunction): void {
  req.orgContext = { org_id: req.user!.org_id };
  next();
}
