import { Router, type Request, type Response } from "express";
import type { ModelAdapter } from "../../adapters/modelAdapter.js";
import { RunEvalRequest } from "../../domain/evalRunTypes.js";
import { newEvalRunId } from "../../domain/ids.js";
import { runEvalSet } from "../../services/evalRunner.js";
import { getEvalRunById, insertPendingEvalRun } from "../../db/repos/evalRunsRepo.js";
import { listRunEventsByRunId } from "../../db/repos/runEventsRepo.js";
import { isTerminalEvent, pipelineEventBus } from "../../services/events/pipelineEventBus.js";
import type { RunEvent } from "../../domain/schemas.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

// RAG-pipeline visibility follow-up: evalRunner.ts's EVAL_ORG is hardcoded
// to org_default (eval fixtures only ever reference org_default's seeded
// tickets) — but until now nothing on this router enforced that the
// *caller* was also org_default. A non-default org's admin calling
// POST /eval-runs could already read org_default's real ticket/customer/
// draft content back in the synchronous response (runEvalSet() always
// operates against EVAL_ORG regardless of req.orgContext), and the
// resulting eval_runs row always landed under org_default's own history
// regardless of who triggered it — a real cross-tenant exposure, not just
// a missing UI restriction. Same enforcement shape as POST /orgs
// (orgs.ts) and /platform/* (platform.ts): permission alone isn't
// sufficient, the route itself also checks org_id === "org_default".
function requireOrgDefault(req: Request, res: Response): boolean {
  if (req.orgContext!.org_id !== "org_default") {
    sendError(res, "FORBIDDEN", "Only org_default may run or view evals");
    return false;
  }
  return true;
}

// Factory so tests can inject a scenario-specific MockModelAdapter, same
// pattern as buildTicketsRouter (LLD §1: MockModelAdapter in every test).
export function buildEvalRunsRouter(modelAdapter: ModelAdapter): Router {
  const evalRunsRouter = Router();

  // V4-6 (LLD_v4 §4, HLD_v4 ADR-20): mints an eval_run_id and persists a
  // pending eval_runs row (completed_at/metrics/case_results all null) —
  // lets a client subscribe to GET /eval-runs/:runId/events before POSTing
  // the run itself, without the SSE route racing the run's first event.
  evalRunsRouter.post("/start", requirePermission("eval_runs:run"), async (req, res, next) => {
    try {
      if (!requireOrgDefault(req, res)) return;
      const evalRunId = newEvalRunId();
      await insertPendingEvalRun(req.orgContext!, { eval_run_id: evalRunId, started_at: new Date().toISOString() });
      res.status(201).json({ data: { eval_run_id: evalRunId } });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.12: { case_ids? } — default all. Always synchronous here (see
  // evalRunner.ts for why — 8 seed cases never approach the async
  // threshold LLD allows for). V4-6: eval_run_id is optional — when
  // supplied (from POST /eval-runs/start), the runner reuses it.
  evalRunsRouter.post("/", requirePermission("eval_runs:run"), async (req, res, next) => {
    try {
      if (!requireOrgDefault(req, res)) return;
      const parsed = RunEvalRequest.safeParse(req.body ?? {});
      if (!parsed.success) {
        sendError(res, "VALIDATION_ERROR", "Invalid eval-run request", parsed.error.flatten());
        return;
      }
      const report = parsed.data.eval_run_id
        ? await runEvalSet(modelAdapter, parsed.data.case_ids, parsed.data.eval_run_id)
        : await runEvalSet(modelAdapter, parsed.data.case_ids);
      res.status(201).json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  evalRunsRouter.get("/:id", requirePermission("runs:view"), async (req, res, next) => {
    try {
      if (!requireOrgDefault(req, res)) return;
      const run = await getEvalRunById(req.orgContext!, req.params.id);
      if (!run) {
        sendError(res, "NOT_FOUND", `Eval run ${req.params.id} not found`);
        return;
      }
      res.status(200).json({ data: run });
    } catch (err) {
      next(err);
    }
  });

  // V4-7 (LLD_v4 §4, HLD_v4 ADR-20): near-verbatim mirror of tickets.ts's
  // GET /:id/runs/:runId/events, minus the ticket-ownership lookup — an
  // eval run has no ticket_id, and eval_run_id is itself an unguessable
  // nanoid (same "safe to key purely by run_id" reasoning runEventsRepo.ts
  // already documents for run_events).
  evalRunsRouter.get("/:runId/events", requirePermission("runs:view"), async (req, res, next) => {
    try {
      if (!requireOrgDefault(req, res)) return;
      const persisted = await listRunEventsByRunId(req.params.runId);
      const run = await getEvalRunById(req.orgContext!, req.params.runId);
      if (!run && persisted.length === 0) {
        sendError(res, "NOT_FOUND", `Eval run ${req.params.runId} not found`);
        return;
      }

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      for (const event of persisted) {
        writeSseEvent(res, event.stage, event.status, event.summary, event.created_at);
      }

      if (run && run.completed_at != null) {
        // Already completed — nothing more will ever be emitted for this
        // run_id. A *pending* row (POST /eval-runs/start, completed_at
        // still null) falls through to the live subscribe below instead.
        res.end();
        return;
      }

      const unsubscribe = pipelineEventBus.subscribe(req.params.runId, (event: RunEvent) => {
        writeSseEvent(res, event.stage, event.status, event.summary, event.ts);
        if (isTerminalEvent(event)) {
          unsubscribe();
          res.end();
        }
      });
      req.on("close", unsubscribe);
    } catch (err) {
      next(err);
    }
  });

  return evalRunsRouter;
}

function writeSseEvent(res: Response, stage: string, status: string, summary: unknown, ts: string): void {
  res.write(`data: ${JSON.stringify({ stage, status, summary, ts })}\n\n`);
}
