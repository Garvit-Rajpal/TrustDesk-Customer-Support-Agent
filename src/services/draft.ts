// DraftService (HLD §4.2, LLD §4.7). Order is triage → retrieval → draft
// (HLD invariant #9 enforces this at the route level with a 409). The
// model proposes a draft; this function is what disposes: L3 output scan
// runs after every generation, and a fail-closed result discards the model
// draft entirely in favor of a deterministic template (HLD invariant #5).
import type { ModelAdapter } from "../adapters/modelAdapter.js";
import type { Customer, Order, Ticket } from "../domain/entities.js";
import type { OrgContext } from "../domain/orgContext.js";
import { GuardrailResult, RawDraftOutput, TriageResult } from "../domain/schemas.js";
import { newDraftId, newRunId } from "../domain/ids.js";
import { inputScan } from "./guardrails/inputScan.js";
import { outputScan } from "./guardrails/outputScan.js";
import { ESCALATION_TEMPLATE_BODY } from "./guardrails/templates/escalation.js";
import { DRAFT_SYSTEM_PROMPT, buildDraftUserPrompt } from "./prompts/draft.v1.js";
import { buildBroadQueryText, searchDocuments, searchSimilarResolutions } from "./retrieval.js";
import type { EmbeddingAdapter } from "../adapters/embeddingAdapter.js";
import { semanticJudgeScan } from "./guardrails/semanticJudge.js";
import { orgPolicyScan } from "./guardrails/orgPolicyScan.js";
import { getOrgById } from "../db/repos/orgsRepo.js";
import { computeEligibilityFacts } from "./eligibility.js";
import { getKbDocumentById, listKbDocuments } from "../db/repos/kbDocumentsRepo.js";
import { listToolCatalog } from "../db/repos/toolCatalogRepo.js";
import { insertDraft } from "../db/repos/draftsRepo.js";
import { insertAgentRun } from "../db/repos/agentRunsRepo.js";
import { getLatestInboundMessage, listMessagesByTicketId } from "../db/repos/ticketMessagesRepo.js";
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

// V3-5 (LLD_v3 §3, HLD_v3 ADR-15, invariant #10): the auto-send decision is
// deterministic code over the draft's already-guardrail-passed output, never
// the model itself — same "model proposes, deterministic code disposes"
// rule as requires_human_approval (invariant #1), just applied one step
// further down the pipeline. Escalated/refused_by_policy drafts, and any
// draft recommending an approval-gated action, always wait for a human.
export function evaluateAutoSend(outcome: DraftOutcome): boolean {
  return (
    outcome.resolutionType === "answered" &&
    outcome.recommendedActions.every((action) => !action.requires_human_approval)
  );
}

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
  ctx: OrgContext,
  modelAdapter: ModelAdapter,
  ticket: Ticket,
  customer: Customer,
  order: Order | null,
  // V4-13 (LLD_v4 §5, HLD_v4 ADR-21): optional, deliberately never passed
  // by the eval runner — eval-run prompts (and therefore scoring) stay
  // exactly as before W15, unaffected by whatever similarity state happens
  // to exist in a given environment.
  embeddingAdapter?: EmbeddingAdapter,
  // V4-15 (LLD_v4 §6, HLD_v4 ADR-22): optional, same "deliberately never
  // passed by the eval runner / direct-call tests unless they opt in" shape
  // as embeddingAdapter above — buildTicketsRouter always supplies one for
  // the real app (reusing the primary modelAdapter, distinguished by the
  // ":judge" scenario suffix, same idiom triage/draft already share).
  judgeModelAdapter?: ModelAdapter
): Promise<DraftOutcome> {
  const startedAt = Date.now();
  const runId = newRunId();

  // ticket.triage is required by the caller (route enforces 409 otherwise —
  // HLD invariant #9). Re-parsed here because it comes back from Postgres as
  // untyped jsonb.
  const triage = TriageResult.parse(ticket.triage);

  // V2-4 (LLD_v2 §5): "draft targets the latest inbound message" — same
  // rationale as TriageService's latestInboundBody (see triage.ts).
  const [latestInbound, threadMessages] = await Promise.all([
    getLatestInboundMessage(ctx, ticket.ticket_id),
    listMessagesByTicketId(ctx, ticket.ticket_id),
  ]);
  const latestInboundBody = latestInbound?.body ?? ticket.body;
  // Prior messages only — the latest inbound one is shown separately in its
  // own fenced block by buildDraftUserPrompt.
  const priorThreadMessages = latestInbound
    ? threadMessages.filter((m) => m.message_id !== latestInbound.message_id)
    : threadMessages;

  // Stage order below follows ADR-8's pipeline (input_scan → retrieval →
  // eligibility → draft_generation → output_scan); none of these steps
  // actually depend on one another's output, so ordering them this way is
  // free and makes the emitted event sequence match the documented pipeline.
  await pipelineEventBus.emitStage(runId, "input_scan", "started");
  const l1Results = inputScan(ticket.subject, latestInboundBody);
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
    ctx,
    buildBroadQueryText(`${ticket.subject} ${latestInboundBody}`),
    triage.category
  );
  const retrievedDocIds = searchResults.map((r) => r.doc_id);
  const retrievedDocs = (
    await Promise.all(retrievedDocIds.map((id) => getKbDocumentById(ctx, id)))
  ).filter((d): d is NonNullable<typeof d> => d !== null);
  await pipelineEventBus.emitStage(runId, "retrieval", "completed", {
    doc_ids: retrievedDocIds,
    counts: { documents: retrievedDocIds.length },
  });

  // V4-13: best-effort, same resilience posture as W15's ingestion hook — a
  // down embedding provider degrades to "no similarity context" rather than
  // failing draft generation.
  let similarResolutions: string[] = [];
  if (embeddingAdapter) {
    try {
      similarResolutions = await searchSimilarResolutions(
        ctx,
        embeddingAdapter,
        `${ticket.subject} ${latestInboundBody}`,
        triage.category
      );
    } catch (err) {
      console.warn(`[trustdesk] similar-resolution search failed for ${ticket.ticket_id}:`, err);
    }
  }

  await pipelineEventBus.emitStage(runId, "eligibility", "started");
  const facts = computeEligibilityFacts(ticket.created_at, order, customer);
  await pipelineEventBus.emitStage(runId, "eligibility", "completed");

  const toolCatalog = await listToolCatalog(); // global reference data, not org-scoped (V2-5)

  const l2Result = GuardrailResult.parse({
    layer: "prompt_structure",
    check: "delimited_untrusted_block",
    passed: true,
  });

  const userPrompt = buildDraftUserPrompt(
    ticket,
    latestInboundBody,
    priorThreadMessages,
    retrievedDocs,
    facts,
    flags,
    toolCatalog,
    similarResolutions
  );

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

  const allKbDocs = await listKbDocuments(ctx);
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
    // V4-16: org policy-pack rule layer runs alongside outputScan() —
    // strictly scoped to this ticket's own org's vertical (never a sibling
    // org's rules), a failure from either feeds the same fail-closed
    // substitution below (LLD_v4 §6).
    const org = await getOrgById(ctx.org_id);
    const orgPolicyResults = org ? orgPolicyScan(parsed, org.vertical) : [];
    const orgPolicyPassed = orgPolicyResults.every((r) => r.passed);
    l3Results = [...scan.results, ...orgPolicyResults];
    const overallPassed = scan.passed && orgPolicyPassed;
    const l3FailedCount = l3Results.filter((r) => !r.passed).length;
    await pipelineEventBus.emitStage(runId, "output_scan", overallPassed ? "completed" : "blocked", {
      counts: { passed: l3Results.length - l3FailedCount, failed: l3FailedCount },
    });

    if (!overallPassed) {
      status = "guardrail_blocked";
      resultBody = ESCALATION_TEMPLATE_BODY;
      resultCitations = [];
      resultResolutionType = "escalated";
      sanitizedActions = [];
      rejectedOutput = parsed;
    } else if (judgeModelAdapter) {
      // V4-15: L3 passed — run the semantic judge next. A failing verdict
      // reuses this exact same fail-closed substitution point rather than
      // inventing a second disposal path (LLD_v4 §6).
      const judgeResult = await semanticJudgeScan(judgeModelAdapter, ticket, parsed);
      l3Results = [...l3Results, judgeResult];
      if (!judgeResult.passed) {
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
  await insertDraft(ctx, {
    draft_id: draftId,
    ticket_id: ticket.ticket_id,
    run_id: runId,
    resolution_type: resultResolutionType,
    body: resultBody,
    citations: resultCitations,
    recommended_actions: recommendedActions,
    message_id: latestInbound?.message_id ?? null,
  });

  await insertAgentRun(ctx, {
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
