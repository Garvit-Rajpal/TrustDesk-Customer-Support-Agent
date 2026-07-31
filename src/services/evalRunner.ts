// EvalRunner (HLD §4.4, LLD §7). Runs eval_cases.jsonl through the SAME
// production triage + draft pipeline used by the live API — no parallel
// scoring-only implementation, so a passing eval run means the real
// pipeline behaves correctly, not a simulation of it.
//
// LLD §4.12 allows async execution ("if >N cases, 202 + poll"). With only
// 8 seed eval cases, this system always runs synchronously — building
// queue/polling infrastructure for a dataset this size would be unused
// machinery, not a feature (see docs/PROGRESS.md). GET /eval-runs/:id still
// works for re-fetching a completed run.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { ModelAdapter } from "../adapters/modelAdapter.js";
import { EvalCase, EvalCaseResult, EvalMetrics } from "../domain/evalTypes.js";
import { newEvalRunId } from "../domain/ids.js";
import type { OrgContext } from "../domain/orgContext.js";
import { getTicketById } from "../db/repos/ticketsRepo.js";
import { getCustomerById } from "../db/repos/customersRepo.js";
import { getOrderById } from "../db/repos/ordersRepo.js";
import { insertEvalRun } from "../db/repos/evalRunsRepo.js";
import { runTriage } from "./triage.js";
import { generateDraft } from "./draft.js";
import { aggregateMetrics, failedCaseResult, scoreCase } from "./evalScorer.js";
import { pipelineEventBus } from "./events/pipelineEventBus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_CASES_PATH = path.resolve(__dirname, "../../data/eval_cases.jsonl");

// V2-5 (LLD_v2 §6): "Eval runner: scoped to org_default (the only org with
// seeded eval cases); v1 metrics unchanged." Every eval case references a
// seed ticket_id (tkt_9001 etc.), which only exists under org_default —
// there's no case_id -> org mapping to derive a context from, so the
// runner is hardcoded to the one tenant that has eval fixtures at all.
const EVAL_ORG: OrgContext = { org_id: "org_default" };

export async function loadEvalCases(): Promise<EvalCase[]> {
  const raw = await readFile(EVAL_CASES_PATH, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => EvalCase.parse(JSON.parse(line)));
}

async function runOneCase(modelAdapter: ModelAdapter, evalCase: EvalCase): Promise<EvalCaseResult> {
  const ticket = await getTicketById(EVAL_ORG, evalCase.ticket_id);
  if (!ticket) {
    throw new Error(`eval case ${evalCase.case_id} references unknown ticket ${evalCase.ticket_id}`);
  }
  const customer = await getCustomerById(EVAL_ORG, ticket.customer_id);
  const order = ticket.order_id ? await getOrderById(EVAL_ORG, ticket.order_id) : null;

  const triageOutcome = await runTriage(EVAL_ORG, modelAdapter, ticket, customer!, order);
  if (triageOutcome.status === "failed") {
    return failedCaseResult(evalCase.case_id, evalCase.ticket_id, triageOutcome.runId);
  }

  // Re-fetch: generateDraft reads ticket.triage from the row, and runTriage
  // just persisted it (same "triage → retrieval → draft" order as the API,
  // HLD invariant #9).
  const triagedTicket = await getTicketById(EVAL_ORG, evalCase.ticket_id);
  const draftOutcome = await generateDraft(EVAL_ORG, modelAdapter, triagedTicket!, customer!, order);

  return scoreCase(
    evalCase.case_id,
    evalCase.ticket_id,
    evalCase.expected,
    { category: triageOutcome.result.category, should_escalate: triageOutcome.result.should_escalate },
    {
      citations: draftOutcome.citations,
      resolutionType: draftOutcome.resolutionType,
      recommendedActions: draftOutcome.recommendedActions,
    },
    { triageRunId: triageOutcome.runId, draftRunId: draftOutcome.runId }
  );
}

export interface EvalRunReport {
  eval_run_id: string;
  started_at: string;
  completed_at: string;
  total_cases: number;
  metrics: EvalMetrics;
  case_results: EvalCaseResult[];
}

export async function runEvalSet(
  modelAdapter: ModelAdapter,
  caseIds?: string[],
  // V4-6 (LLD_v4 §4, HLD_v4 ADR-20): minted upfront (default) rather than
  // only once the run completes, so a client can mint an ID via
  // POST /eval-runs/start, subscribe to GET /eval-runs/:runId/events, THEN
  // start the run — the same "ID exists before the run does" property
  // single-ticket runs already have via agent_runs' run_id.
  evalRunId: string = newEvalRunId()
): Promise<EvalRunReport> {
  const startedAt = new Date().toISOString();
  const allCases = await loadEvalCases();
  const cases = caseIds ? allCases.filter((c) => caseIds.includes(c.case_id)) : allCases;

  // Sequential, not Promise.all: each case writes its own agent_run rows,
  // and the production services aren't designed for concurrent calls
  // against the same MockModelAdapter call-count bookkeeping.
  const caseResults: EvalCaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const evalCase = cases[i]!;
    const counts = { index: i + 1, total: cases.length };
    await pipelineEventBus.emitStage(evalRunId, "eval_case", "started", { case_id: evalCase.case_id, counts });
    try {
      caseResults.push(await runOneCase(modelAdapter, evalCase));
      await pipelineEventBus.emitStage(evalRunId, "eval_case", "completed", { case_id: evalCase.case_id, counts });
    } catch (err) {
      // A terminal event either way, so an SSE subscriber's connection
      // always ends deterministically rather than hanging on a thrown case.
      await pipelineEventBus.emitStage(evalRunId, "eval_case", "failed", { case_id: evalCase.case_id, counts });
      throw err;
    }
  }

  const metrics = aggregateMetrics(caseResults);
  const completedAt = new Date().toISOString();

  await insertEvalRun(EVAL_ORG, {
    eval_run_id: evalRunId,
    started_at: startedAt,
    completed_at: completedAt,
    total_cases: cases.length,
    metrics,
    case_results: caseResults,
  });

  return {
    eval_run_id: evalRunId,
    started_at: startedAt,
    completed_at: completedAt,
    total_cases: cases.length,
    metrics,
    case_results: caseResults,
  };
}
