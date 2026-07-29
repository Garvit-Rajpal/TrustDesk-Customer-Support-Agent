import { Router } from "express";
import { CreateOrgRequest } from "../../domain/orgTypes.js";
import { createOrg } from "../../services/orgOnboarding.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const orgsRouter = Router();

// V2-5 (LLD_v2 §6/§9): admin-only, AND restricted to org_default's admins.
// There is no real cross-org platform-admin role yet (that's v3) — until
// then, org_default (the original tenant) stands in as the one that gets
// to onboard every other tenant, so a regular tenant's own admin can't spin
// up unrelated orgs from inside their own dashboard.
orgsRouter.post("/", requirePermission("orgs:create"), async (req, res, next) => {
  try {
    if (req.orgContext!.org_id !== "org_default") {
      sendError(res, "FORBIDDEN", "Only org_default admins may onboard new orgs");
      return;
    }

    const parsed = CreateOrgRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "Invalid org creation request", parsed.error.flatten());
      return;
    }

    const outcome = await createOrg(parsed.data);
    if (outcome.kind === "username_taken") {
      sendError(res, "CONFLICT", `Username ${parsed.data.admin_username} is already taken`);
      return;
    }

    res.status(201).json({
      data: {
        org: outcome.org,
        admin_user_id: outcome.admin_user_id,
        document_ids: outcome.document_ids,
        customer_ids: outcome.customer_ids,
      },
    });
  } catch (err) {
    next(err);
  }
});
