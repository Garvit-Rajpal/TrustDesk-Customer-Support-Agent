import type { TokenClaims } from "../domain/authTypes.js";

// Augments Express's Request with the decoded JWT (set by authMiddleware).
declare global {
  namespace Express {
    interface Request {
      user?: TokenClaims;
    }
  }
}

export {};
