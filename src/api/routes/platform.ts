// V3-6 (LLD_v3 §4, HLD_v3 ADR-16): read-only cross-org visibility for
// org_default, gated on the target org's own consent flags. This is the one
// router family that deliberately constructs an OrgContext from a query
// param instead of using req.orgContext — same precedent POST /orgs already
// set for crossing the tenancy boundary on purpose. No triage/draft/reply/
// tool-action routes exist here: platform support is view-only.
import { Router } from "express";
import type { OrgContext } from "../../domain/orgContext.js";
import { getOrgById, getOrgBySlug } from "../../db/repos/orgsRepo.js";
import { getTicketById, listTickets } from "../../db/repos/ticketsRepo.js";
import { listMessagesByTicketId } from "../../db/repos/ticketMessagesRepo.js";
import { getCategorizedFeedback } from "../../db/repos/feedbackRepo.js";
import { getCategorizedApprovals } from "../../db/repos/approvalsRepo.js";
import { getCategorizedDraftRuns } from "../../db/repos/agentRunsRepo.js";
import { computeQualityMetrics } from "../../services/qualityMetrics.js";
import { sendError, type ErrorCode } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";
import type { Response } from "express";

export const platformRouter = Router();

function requireOrgDefault(callerOrgId: string): boolean {
  return callerOrgId === "org_default";
}

type ConsentField = "allow_platform_support" | "allow_platform_metrics";

// Missing target_org_id is a caller mistake (400), not a permission/consent
// outcome (403) — kept distinct so the RBAC route-table test (an allowed
// role must never see 403 for a reason unrelated to its own permission
// check) stays meaningful for these routes.
type ResolveResult = { ctx: OrgContext } | { errorCode: ErrorCode; message: string };

// target_org_id may be either the org's opaque id or its (unique) slug —
// name is deliberately not accepted here since orgs.name has no unique
// constraint (see orgOnboarding.ts) and would resolve ambiguously.
async function resolveConsentingTarget(
  targetOrgId: string | undefined,
  consentField: ConsentField
): Promise<ResolveResult> {
  if (!targetOrgId) {
    return { errorCode: "VALIDATION_ERROR", message: "target_org_id query param is required" };
  }
  const targetOrg = (await getOrgById(targetOrgId)) ?? (await getOrgBySlug(targetOrgId));
  if (!targetOrg || !targetOrg[consentField]) {
    return { errorCode: "FORBIDDEN", message: "Target org has not consented to this platform view" };
  }
  return { ctx: { org_id: targetOrg.org_id } };
}

async function resolveOrFail(
  res: Response,
  callerOrgId: string,
  targetOrgId: string | undefined,
  consentField: ConsentField
): Promise<OrgContext | null> {
  if (!requireOrgDefault(callerOrgId)) {
    sendError(res, "FORBIDDEN", "Only org_default may view cross-org platform support data");
    return null;
  }
  const resolved = await resolveConsentingTarget(targetOrgId, consentField);
  if ("errorCode" in resolved) {
    sendError(res, resolved.errorCode, resolved.message);
    return null;
  }
  return resolved.ctx;
}

platformRouter.get("/tickets", requirePermission("platform:tickets:view"), async (req, res, next) => {
  try {
    const targetOrgId = typeof req.query.target_org_id === "string" ? req.query.target_org_id : undefined;
    const ctx = await resolveOrFail(res, req.orgContext!.org_id, targetOrgId, "allow_platform_support");
    if (!ctx) return;
    const tickets = await listTickets(ctx);
    res.status(200).json({ data: { tickets } });
  } catch (err) {
    next(err);
  }
});

platformRouter.get(
  "/tickets/:id/messages",
  requirePermission("platform:tickets:view"),
  async (req, res, next) => {
    try {
      const targetOrgId = typeof req.query.target_org_id === "string" ? req.query.target_org_id : undefined;
      const ctx = await resolveOrFail(res, req.orgContext!.org_id, targetOrgId, "allow_platform_support");
      if (!ctx) return;
      const ticket = await getTicketById(ctx, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const messages = await listMessagesByTicketId(ctx, ticket.ticket_id);
      res.status(200).json({ data: { messages } });
    } catch (err) {
      next(err);
    }
  }
);

platformRouter.get("/metrics", requirePermission("platform:metrics:view"), async (req, res, next) => {
  try {
    const targetOrgId = typeof req.query.target_org_id === "string" ? req.query.target_org_id : undefined;
    const ctx = await resolveOrFail(res, req.orgContext!.org_id, targetOrgId, "allow_platform_metrics");
    if (!ctx) return;
    const [feedback, approvals, agentRuns] = await Promise.all([
      getCategorizedFeedback(ctx),
      getCategorizedApprovals(ctx),
      getCategorizedDraftRuns(ctx),
    ]);
    const report = computeQualityMetrics({ feedback, approvals, agentRuns });
    res.status(200).json({ data: report });
  } catch (err) {
    next(err);
  }
});
