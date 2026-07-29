import { Router } from "express";
import { getDashboardSummary } from "../../services/dashboardSummary.js";
import { requirePermission } from "../middleware/permissions.js";

export const dashboardRouter = Router();

// V3-7 (LLD_v3 §5, HLD_v3 ADR-17): agent+ — every logged-in user lands on
// this after login, same tier as tickets:view.
dashboardRouter.get("/summary", requirePermission("dashboard:view"), async (req, res, next) => {
  try {
    const summary = await getDashboardSummary(req.orgContext!);
    res.status(200).json({ data: summary });
  } catch (err) {
    next(err);
  }
});
