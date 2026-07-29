import { Router } from "express";
import bcrypt from "bcrypt";
import { InviteUserRequest } from "../../domain/authTypes.js";
import { newUserId } from "../../domain/ids.js";
import { getUserByUsername, insertUser } from "../../db/repos/usersRepo.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const usersRouter = Router();

// V2-2 (LLD_v2 §3/§9, ADR-9): admin-only account creation. "org" scoping
// (LLD_v2 §5: invited user lands in the inviter's org) is a no-op until
// V2-5 adds orgs — there is exactly one implicit tenant today, the same one
// every v1 seed user already belongs to.
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
    await insertUser({ user_id, username, password_hash, display_name, role });

    res.status(201).json({ data: { user_id, username, display_name, role } });
  } catch (err) {
    next(err);
  }
});
