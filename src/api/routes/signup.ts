import { Router } from "express";
import rateLimit from "express-rate-limit";
import { CreateOrgRequest } from "../../domain/orgTypes.js";
import { createOrg } from "../../services/orgOnboarding.js";
import { signToken } from "../../services/tokens.js";
import { sendError } from "../errorEnvelope.js";

export const signupRouter = Router();

// V3-3 (LLD_v3 §2, HLD_v3 ADR-14): the one unauthenticated, write-capable
// route in the whole app — a prospective tenant creates their own org +
// admin account with no gatekeeping. Rate-limited per IP since nothing else
// stands between this route and the internet.
const signupRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, "RATE_LIMITED", "Too many signup attempts — try again later");
  },
});

// Same request shape and createOrg() service as the existing admin-only
// POST /orgs (LLD_v2 §6) — this route differs only in who may call it (no
// auth at all) and what happens on success (auto-login instead of just
// returning the created org, so the signer lands directly in the app).
signupRouter.post("/", signupRateLimiter, async (req, res, next) => {
  try {
    const parsed = CreateOrgRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "Invalid signup request", parsed.error.flatten());
      return;
    }

    const outcome = await createOrg(parsed.data);
    if (outcome.kind === "username_taken") {
      sendError(res, "CONFLICT", `Username ${parsed.data.admin_username} is already taken`);
      return;
    }

    const token = signToken({
      sub: outcome.admin_user_id,
      name: parsed.data.admin_display_name,
      role: "admin",
      org_id: outcome.org.org_id,
    });

    res.status(201).json({
      data: {
        token,
        user: {
          user_id: outcome.admin_user_id,
          display_name: parsed.data.admin_display_name,
          role: "admin",
          org_id: outcome.org.org_id,
        },
        org: { org_id: outcome.org.org_id, name: outcome.org.name, slug: outcome.org.slug },
        document_ids: outcome.document_ids,
        customer_ids: outcome.customer_ids,
      },
    });
  } catch (err) {
    next(err);
  }
});
