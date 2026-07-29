import type { TokenClaims } from "../domain/authTypes.js";
import type { OrgContext } from "../domain/orgContext.js";

// Augments Express's Request with the decoded JWT (set by authMiddleware)
// and the tenancy context derived from it (set by tenancyMiddleware, V2-5).
declare global {
  namespace Express {
    interface Request {
      user?: TokenClaims;
      orgContext?: OrgContext;
    }
  }
}

export {};
