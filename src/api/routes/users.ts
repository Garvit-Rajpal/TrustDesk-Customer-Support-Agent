import { Router } from "express";
import bcrypt from "bcrypt";
import { InviteUserRequest } from "../../domain/authTypes.js";
import { newUserId } from "../../domain/ids.js";
import { getUserByUsername, insertUser, markWelcomeSeen } from "../../db/repos/usersRepo.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const usersRouter = Router();

// V2-2/V2-5 (LLD_v2 §3/§6/§9, ADR-9): admin-only account creation. Invited
// user lands in the inviter's org (req.orgContext, from their JWT).
usersRouter.post("/invite", requirePermission("users:invite"), async (req, res, next) => {
  try {
    const parsed = InviteUserRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "Invalid invite request", parsed.error.flatten());
      return;
    }
    const { username, password, display_name, role } = parsed.data;

    const existing = await getUserByUsername(username);
    if (existing) {
      sendError(res, "CONFLICT", `Username ${username} is already taken`);
      return;
    }

    const user_id = newUserId();
    const password_hash = await bcrypt.hash(password, 10);
    await insertUser(req.orgContext!, { user_id, username, password_hash, display_name, role });

    res.status(201).json({ data: { user_id, username, display_name, role } });
  } catch (err) {
    next(err);
  }
});

// V3-7 (LLD_v3 §5): any authenticated user may dismiss their own welcome
// banner — no extra permission beyond being logged in (this touches only
// the caller's own row, identified from the JWT, never another user's).
usersRouter.post("/me/welcome-seen", async (req, res, next) => {
  try {
    const welcomeSeenAt = await markWelcomeSeen(req.orgContext!, req.user!.sub);
    res.status(200).json({ data: { welcome_seen_at: welcomeSeenAt } });
  } catch (err) {
    next(err);
  }
});
