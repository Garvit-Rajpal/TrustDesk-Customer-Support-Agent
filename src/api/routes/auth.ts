import { Router } from "express";
import bcrypt from "bcrypt";
import { LoginRequest } from "../../domain/authTypes.js";
import { getUserByUsername } from "../../db/repos/usersRepo.js";
import { getOrgById } from "../../db/repos/orgsRepo.js";
import { signToken } from "../../services/tokens.js";
import { sendError } from "../errorEnvelope.js";

export const authRouter = Router();

// LLD §4.1: verify credentials against bcrypt hash, issue short-lived JWT.
// No signup endpoint exists (ADR-4) — accounts only via seed/bootstrap.
authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "username and password are required", parsed.error.flatten());
      return;
    }

    const user = await getUserByUsername(parsed.data.username);
    if (!user) {
      sendError(res, "UNAUTHENTICATED", "Invalid username or password");
      return;
    }

    const passwordOk = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!passwordOk) {
      sendError(res, "UNAUTHENTICATED", "Invalid username or password");
      return;
    }

    const token = signToken({
      sub: user.user_id,
      name: user.display_name,
      role: user.role,
      org_id: user.org_id,
    });
    // V2-5 (LLD_v2 §6): "login response includes org" — the frontend topbar
    // needs the org's *name*, not just its id, so this fetches the row
    // rather than only echoing back user.org_id. user.org_id is a FK, so
    // this can never come back null for a real user.
    const org = await getOrgById(user.org_id);
    res.status(200).json({
      data: {
        // V2-2 (LLD_v2 §3): role rides along so the frontend can gate UI
        // (hide approve/execute, ingest, invite, etc.) without a second
        // round trip — it's already in the JWT, this just surfaces it.
        token,
        user: {
          user_id: user.user_id,
          display_name: user.display_name,
          role: user.role,
          org_id: user.org_id,
          // V3-7 (LLD_v3 §5): frontend uses this to decide whether to show
          // the first-login welcome banner without an extra round trip.
          welcome_seen_at: user.welcome_seen_at ?? null,
        },
        org: { org_id: org!.org_id, name: org!.name, slug: org!.slug },
      },
    });
  } catch (err) {
    next(err);
  }
});
