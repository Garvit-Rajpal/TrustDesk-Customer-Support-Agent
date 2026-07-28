// DraftService (HLD §4.2, LLD §4.7). Order is triage → retrieval → draft
// (HLD invariant #9 enforces this at the route level with a 409). The
// model proposes a draft; this function is what disposes: L3 output scan
// runs after every generation, and a fail-closed result discards the model
// draft entirely in favor of a deterministic template (HLD invariant #5).
import type { ModelAdapter } from "../adapters/modelAdapter.js";
import type { Customer, Order, Ticket } from "../domain/entities.js";
import { GuardrailResult, RawDraftOutput, TriageResult } from "../domain/schemas.js";
import { newDraftId, newRunId } from "../domain/ids.js";
import { inputScan } from "./guardrails/inputScan.js";
import { outputScan } from "./guardrails/outputScan.js";
import { ESCALATION_TEMPLATE_BODY } from "./guardrails/templates/escalation.js";
import { DRAFT_SYSTEM_PROMPT, buildDraftUserPrompt } from "./prompts/draft.v1.js";
import { buildBroadQueryText, searchDocuments } from "./retrieval.js";
import { computeEligibilityFacts } from "./eligibility.js";
import { getKbDocumentById, listKbDocuments } from "../db/repos/kbDocumentsRepo.js";
import { listToolCatalog } from "../db/repos/toolCatalogRepo.js";
import { insertDraft } from "../db/repos/draftsRepo.js";
import { insertAgentRun } from "../db/repos/agentRunsRepo.js";
import { pipelineEventBus } from "./events/pipelineEventBus.js";

const STANDARD_AUDIENCE = "Customer support agents";

export interface DraftRecommendedAction {
  tool_name: string;
  requires_human_approval: boolean;
  reason: string;
}

export type DraftOutcome = {
  draftId: string;
  runId: string;
  resolutionType: RawDraftOutput["resolution_type"];
  body: string;
  citations: string[];
  recommendedActions: DraftRecommendedAction[];
};

function tryParseDraft(raw: string): RawDraftOutput | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = RawDraftOutput.safeParse(parsedJson);
  return result.success ? result.data : null;
}

export async function generateDraft(
  modelAdapter: ModelAdapter,
  ticket: Ticket,
  customer: Customer,
  order: Order | null
): Promise<DraftOutcome> {
  const startedAt = Date.now();
  const runId = newRunId();

  // ticket.triage is required by the caller (route enforces 409 otherwise —
  // HLD invariant #9). Re-parsed here because it comes back from Postgres as
  // untyped jsonb.
  const triage = TriageResult.parse(ticket.triage);

  // Stage order below follows ADR-8's pipeline (input_scan → retrieval →
  // eligibility → draft_generation → output_scan); none of these steps
  // actually depend on one another's output, so ordering them this way is
  // free and makes the emitted event sequence match the documented pipeline.
  await pipelineEventBus.emitStage(runId, "input_scan", "started");
  const l1Results = inputScan(ticket.subject, ticket.body);
  const flags = {
    injectionFlag: l1Results.find((r) => r.check === "injection_phrase")?.passed === false,
    secretExtractionFlag: l1Results.find((r) => r.check === "secret_extraction")?.passed === false,
    verificationBypassFlag: l1Results.find((r) => r.check === "verification_bypass")?.passed === false,
  };
  const l1FailedCount = l1Results.filter((r) => !r.passed).length;
  await pipelineEventBus.emitStage(runId, "input_scan", "completed", {
    counts: { passed: l1Results.length - l1FailedCount, failed: l1FailedCount },
  });

  await pipelineEventBus.emitStage(runId, "retrieval", "started");
  const searchResults = await searchDocuments(
    buildBroadQueryText(`${ticket.subject} ${ticket.body}`),
    triage.category
  );
  const retrievedDocIds = searchResults.map((r) => r.doc_id);
  const retrievedDocs = (
    await Promise.all(retrievedDocIds.map((id) => getKbDocumentById(id)))
  ).filter((d): d is NonNullable<typeof d> => d !== null);
  await pipelineEventBus.emitStage(runId, "retrieval", "completed", {
    doc_ids: retrievedDocIds,
    counts: { documents: retrievedDocIds.length },
  });

  await pipelineEventBus.emitStage(runId, "eligibility", "started");
  const facts = computeEligibilityFacts(ticket.created_at, order, customer);
  await pipelineEventBus.emitStage(runId, "eligibility", "completed");

  const toolCatalog = await listToolCatalog();

  const l2Result = GuardrailResult.parse({
    layer: "prompt_structure",
    check: "delimited_untrusted_block",
    passed: true,
  });

  const userPrompt = buildDraftUserPrompt(ticket, retrievedDocs, facts, flags, toolCatalog);

  let raw = "";
  let modelProvider = "";
  let modelName = "";
  let parsed: RawDraftOutput | null = null;

  await pipelineEventBus.emitStage(runId, "draft_generation", "started");

  // Same one-retry pattern as TriageService (LLD §4.6) — not explicitly
  // specified for draft in LLD §4.7, but there's no reason draft output
  // should be less resilient to a single malformed response than triage.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const response = await modelAdapter.complete({
      scenario: `${ticket.ticket_id}:draft`,
      systemPrompt: DRAFT_SYSTEM_PROMPT,
      userPrompt,
      responseFormat: "json",
    });
    raw = response.content;
    modelProvider = response.provider;
    modelName = response.model;
    parsed = tryParseDraft(raw);
  }

  await pipelineEventBus.emitStage(
    runId,
    "draft_generation",
    parsed ? "completed" : "failed",
    parsed ? { resolution_type: parsed.resolution_type } : {}
  );

  const allKbDocs = await listKbDocuments();
  const internalAudienceDocs = allKbDocs
    .filter((d) => d.audience !== STANDARD_AUDIENCE)
    .map((d) => ({ doc_id: d.doc_id, content: d.content }));

  let resultBody: string;
  let resultCitations: string[];
  let resultResolutionType: RawDraftOutput["resolution_type"];
  let sanitizedActions: RawDraftOutput["recommended_actions"];
  let status: "completed" | "guardrail_blocked";
  let rejectedOutput: unknown = null;
  let l3Results: GuardrailResult[];

  if (!parsed) {
    // Couldn't even get a schema-valid draft after retry — fail closed the
    // same way an L3 failure would (HLD invariant #5), since there's no
    // valid model output to run outputScan's checks against at all.
    status = "guardrail_blocked";
    resultBody = ESCALATION_TEMPLATE_BODY;
    resultCitations = [];
    resultResolutionType = "escalated";
    sanitizedActions = [];
    rejectedOutput = raw;
    l3Results = [];
  } else {
    await pipelineEventBus.emitStage(runId, "output_scan", "started");
    const scan = outputScan(parsed, {
      retrievedDocIds,
      internalAudienceDocs,
      systemPromptText: DRAFT_SYSTEM_PROMPT,
      ticketCustomer: { customer_id: ticket.customer_id, email: customer.email },
      ticketCategory: triage.category,
      toolCatalog,
    });
    l3Results = scan.results;
    const l3FailedCount = l3Results.filter((r) => !r.passed).length;
    await pipelineEventBus.emitStage(runId, "output_scan", scan.passed ? "completed" : "blocked", {
      counts: { passed: l3Results.length - l3FailedCount, failed: l3FailedCount },
    });

    if (!scan.passed) {
      status = "guardrail_blocked";
      resultBody = ESCALATION_TEMPLATE_BODY;
      resultCitations = [];
      resultResolutionType = "escalated";
      sanitizedActions = [];
      rejectedOutput = parsed;
    } else {
      status = "completed";
      resultBody = parsed.body;
      resultCitations = parsed.citations;
      resultResolutionType = parsed.resolution_type;
      sanitizedActions = scan.sanitizedActions;
    }
  }

  // HLD invariant #1: requires_human_approval comes ONLY from tool_catalog,
  // never from the model.
  const recommendedActions: DraftRecommendedAction[] = sanitizedActions.map((action) => {
    const tool = toolCatalog.find((t) => t.tool_name === action.tool_name);
    return {
      tool_name: action.tool_name,
      requires_human_approval: tool?.requires_human_approval ?? true,
      reason: action.reason,
    };
  });

  const draftId = newDraftId();
  await insertDraft({
    draft_id: draftId,
    ticket_id: ticket.ticket_id,
    run_id: runId,
    resolution_type: resultResolutionType,
    body: resultBody,
    citations: resultCitations,
    recommended_actions: recommendedActions,
  });

  await insertAgentRun({
    run_id: runId,
    ticket_id: ticket.ticket_id,
    run_type: "draft_reply",
    status,
    retrieved_doc_ids: retrievedDocIds,
    tool_calls: recommendedActions,
    guardrail_results: [...l1Results, l2Result, ...l3Results],
    rejected_output: rejectedOutput,
    model_provider: modelProvider,
    model_name: modelName,
    latency_ms: Date.now() - startedAt,
  });

  return {
    draftId,
    runId,
    resolutionType: resultResolutionType,
    body: resultBody,
    citations: resultCitations,
    recommendedActions,
  };
}
