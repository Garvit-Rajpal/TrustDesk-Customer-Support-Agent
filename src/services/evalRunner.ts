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
import { getTicketById } from "../db/repos/ticketsRepo.js";
import { getCustomerById } from "../db/repos/customersRepo.js";
import { getOrderById } from "../db/repos/ordersRepo.js";
import { insertEvalRun } from "../db/repos/evalRunsRepo.js";
import { runTriage } from "./triage.js";
import { generateDraft } from "./draft.js";
import { aggregateMetrics, failedCaseResult, scoreCase } from "./evalScorer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL_CASES_PATH = path.resolve(__dirname, "../../data/eval_cases.jsonl");

export async function loadEvalCases(): Promise<EvalCase[]> {
  const raw = await readFile(EVAL_CASES_PATH, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => EvalCase.parse(JSON.parse(line)));
}

async function runOneCase(modelAdapter: ModelAdapter, evalCase: EvalCase): Promise<EvalCaseResult> {
  const ticket = await getTicketById(evalCase.ticket_id);
  if (!ticket) {
    throw new Error(`eval case ${evalCase.case_id} references unknown ticket ${evalCase.ticket_id}`);
  }
  const customer = await getCustomerById(ticket.customer_id);
  const order = ticket.order_id ? await getOrderById(ticket.order_id) : null;

  const triageOutcome = await runTriage(modelAdapter, ticket, customer!, order);
  if (triageOutcome.status === "failed") {
    return failedCaseResult(evalCase.case_id, evalCase.ticket_id, triageOutcome.runId);
  }

  // Re-fetch: generateDraft reads ticket.triage from the row, and runTriage
  // just persisted it (same "triage → retrieval → draft" order as the API,
  // HLD invariant #9).
  const triagedTicket = await getTicketById(evalCase.ticket_id);
  const draftOutcome = await generateDraft(modelAdapter, triagedTicket!, customer!, order);

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
  caseIds?: string[]
): Promise<EvalRunReport> {
  const startedAt = new Date().toISOString();
  const allCases = await loadEvalCases();
  const cases = caseIds ? allCases.filter((c) => caseIds.includes(c.case_id)) : allCases;

  // Sequential, not Promise.all: each case writes its own agent_run rows,
  // and the production services aren't designed for concurrent calls
  // against the same MockModelAdapter call-count bookkeeping.
  const caseResults: EvalCaseResult[] = [];
  for (const evalCase of cases) {
    caseResults.push(await runOneCase(modelAdapter, evalCase));
  }

  const metrics = aggregateMetrics(caseResults);
  const completedAt = new Date().toISOString();
  const evalRunId = newEvalRunId();

  await insertEvalRun({
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
