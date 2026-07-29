import { Router } from "express";
import type { ModelAdapter } from "../../adapters/modelAdapter.js";
import { RunEvalRequest } from "../../domain/evalRunTypes.js";
import { runEvalSet } from "../../services/evalRunner.js";
import { getEvalRunById } from "../../db/repos/evalRunsRepo.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

// Factory so tests can inject a scenario-specific MockModelAdapter, same
// pattern as buildTicketsRouter (LLD §1: MockModelAdapter in every test).
export function buildEvalRunsRouter(modelAdapter: ModelAdapter): Router {
  const evalRunsRouter = Router();

  // LLD §4.12: { case_ids? } — default all. Always synchronous here (see
  // evalRunner.ts for why — 8 seed cases never approach the async
  // threshold LLD allows for).
  evalRunsRouter.post("/", requirePermission("eval_runs:run"), async (req, res, next) => {
    try {
      const parsed = RunEvalRequest.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, "VALIDATION_ERROR", "Invalid eval-run request", parsed.error.flatten());
        return;
      }
      const report = await runEvalSet(modelAdapter, parsed.data.case_ids);
      res.status(201).json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  evalRunsRouter.get("/:id", requirePermission("runs:view"), async (req, res, next) => {
    try {
      const run = await getEvalRunById(req.params.id);
      if (!run) {
        sendError(res, "NOT_FOUND", `Eval run ${req.params.id} not found`);
        return;
      }
      res.status(200).json({ data: run });
    } catch (err) {
      next(err);
    }
  });

  return evalRunsRouter;
}
