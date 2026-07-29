import { Router } from "express";
import bcrypt from "bcrypt";
import { InviteUserRequest } from "../../domain/authTypes.js";
import { newUserId } from "../../domain/ids.js";
import { getUserByUsername, insertUser } from "../../db/repos/usersRepo.js";
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
