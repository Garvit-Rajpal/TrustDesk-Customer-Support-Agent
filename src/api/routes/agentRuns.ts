import { Router } from "express";
import { getAgentRunById } from "../../db/repos/agentRunsRepo.js";
import { sendError } from "../errorEnvelope.js";

export const agentRunsRouter = Router();

// LLD §4.11: full trace incl. guardrail_results and rejected_output if present.
agentRunsRouter.get("/:runId", async (req, res, next) => {
  try {
    const run = await getAgentRunById(req.params.runId);
    if (!run) {
      sendError(res, "NOT_FOUND", `Agent run ${req.params.runId} not found`);
      return;
    }
    res.status(200).json({ data: run });
  } catch (err) {
    next(err);
  }
});
