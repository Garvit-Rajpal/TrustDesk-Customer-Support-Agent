// TriageService (HLD §4.1, LLD §4.6). No retrieval — classification only.
// Model proposes, this function disposes: the model's should_escalate is
// overridden (never merely supplemented) by deterministic guardrail flags
// (HLD invariant #1).
import type { ModelAdapter } from "../adapters/modelAdapter.js";
import type { Customer, Order, Ticket } from "../domain/entities.js";
import type { OrgContext } from "../domain/orgContext.js";
import { GuardrailResult, TriageResult } from "../domain/schemas.js";
import { newRunId } from "../domain/ids.js";
import { inputScan } from "./guardrails/inputScan.js";
import { TRIAGE_SYSTEM_PROMPT, buildTriageUserPrompt } from "./prompts/triage.v1.js";
import { insertAgentRun } from "../db/repos/agentRunsRepo.js";
import { updateTicketStatus, updateTicketTriage } from "../db/repos/ticketsRepo.js";
import { getLatestInboundMessage } from "../db/repos/ticketMessagesRepo.js";
import { pipelineEventBus } from "./events/pipelineEventBus.js";
import { canTransition } from "./ticketStatus.js";
import { postPipelineFailureFallback } from "./pipelineFailureFallback.js";

export type TriageOutcome =
  | { status: "completed"; result: TriageResult; runId: string }
  | { status: "failed"; runId: string; error: string };

function tryParseTriage(raw: string): TriageResult | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = TriageResult.safeParse(parsedJson);
  return result.success ? result.data : null;
}

export async function runTriage(
  ctx: OrgContext,
  modelAdapter: ModelAdapter,
  ticket: Ticket,
  customer: Customer,
  order: Order | null
): Promise<TriageOutcome> {
  const startedAt = Date.now();
  const runId = newRunId();

  // V2-4 (LLD_v2 §5, ADR-10): classify whichever message is latest, not
  // always ticket.body — this is both what lets category shift mid-thread
  // and how "L1 runs on every inbound message" is satisfied: a mid-thread
  // injection appended via simulate-inbound becomes "latest" and gets
  // scanned the next time triage runs, even though it never touched
  // ticket.body itself.
  const latestInbound = await getLatestInboundMessage(ctx, ticket.ticket_id);
  const latestInboundBody = latestInbound?.body ?? ticket.body;

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

  // L2 is structural (fenced blocks, always applied by construction — see
  // triage.v1.ts) rather than a detector, so it always logs a pass. Still
  // recorded so the trace proves the guardrail ran even on a clean ticket
  // (LLD §5: "a clean ticket gets passed entries").
  const l2Result = GuardrailResult.parse({
    layer: "prompt_structure",
    check: "delimited_untrusted_block",
    passed: true,
  });

  const userPrompt = buildTriageUserPrompt(ticket, customer, order, latestInboundBody, flags);

  let raw = "";
  let modelProvider = "";
  let modelName = "";
  let parsed: TriageResult | null = null;

  await pipelineEventBus.emitStage(runId, "triage", "started");

  // LLD §4.6: "zod parse (1 retry on parse failure, then run status: failed)".
  // The adapter call itself is also wrapped here (not just the JSON it
  // returns) — a thrown error (adapter network failure, or in dev with
  // MODEL_TIER=mock, no scenario registered for a freshly-created ticket)
  // is treated identically to an invalid response: it consumes a retry
  // attempt, and its message is captured into `raw` so the eventual failed
  // agent_runs row's `rejected_output` still explains what happened,
  // instead of the exception propagating uncaught out of this function.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      const response = await modelAdapter.complete({
        // Suffixed so a shared MockModelAdapter can serve both triage and
        // draft calls for the same ticket without one queue's responses
        // leaking into the other's call count.
        scenario: `${ticket.ticket_id}:triage`,
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        userPrompt,
        responseFormat: "json",
      });
      raw = response.content;
      modelProvider = response.provider;
      modelName = response.model;
      parsed = tryParseTriage(raw);
    } catch (err) {
      raw = err instanceof Error ? err.message : String(err);
    }
  }

  const guardrailResults = [...l1Results, l2Result];
  const latencyMs = Date.now() - startedAt;

  if (!parsed) {
    await pipelineEventBus.emitStage(runId, "triage", "failed");

    // A failed triage still needs to move the ticket forward the same two
    // steps a successful triage + sent draft/reply would — otherwise a
    // ticket stays stuck forever, and the customer's *next* message gets
    // silently rejected by receiveCustomerMessage()'s canTransition guard
    // (LLD_v2 §5), with no feedback at all. Step 1 mirrors the identical
    // "someone needs to look at this" advance the success path applies
    // below (open/customer_replied → in_progress). Step 2 mirrors what
    // sendDraft()/sendManualReply() apply after actually sending something
    // to the customer (in_progress → awaiting_customer) — since the
    // fallback message posted below *is* exactly that, a real reply, this
    // must reach the same status a normal sent reply would, or the
    // customer stays just as locked out as before this fix.
    let currentStatus: string = ticket.status;
    if (canTransition(currentStatus, "in_progress")) {
      await updateTicketStatus(ctx, ticket.ticket_id, "in_progress");
      currentStatus = "in_progress";
    }
    if (canTransition(currentStatus, "awaiting_customer")) {
      await updateTicketStatus(ctx, ticket.ticket_id, "awaiting_customer");
    }

    // Deterministic fallback (pipelineFailureFallback.ts), mirroring the
    // guardrail L3 fail-closed template (invariant #5) and
    // ticketGreeting.ts's greeting — a real, persisted thread message the
    // customer sees even on reload, not just an ephemeral WS status frame.
    await postPipelineFailureFallback(ctx, ticket.ticket_id);

    await insertAgentRun(ctx, {
      run_id: runId,
      ticket_id: ticket.ticket_id,
      run_type: "triage",
      status: "failed",
      retrieved_doc_ids: [],
      tool_calls: [],
      guardrail_results: guardrailResults,
      rejected_output: raw,
      model_provider: modelProvider,
      model_name: modelName,
      latency_ms: latencyMs,
    });
    return { status: "failed", runId, error: "Model output failed schema validation after retry" };
  }

  // Deterministic override (HLD invariant #1): a guardrail flag ALWAYS
  // forces escalation, regardless of what the model decided — this is what
  // defeats tkt_9006's "don't tell the reviewer" injection even if the
  // model was convinced by it.
  const anyFlag = flags.injectionFlag || flags.secretExtractionFlag || flags.verificationBypassFlag;
  const result: TriageResult = anyFlag ? { ...parsed, should_escalate: true } : parsed;

  await pipelineEventBus.emitStage(runId, "triage", "completed", { category: result.category });
  await updateTicketTriage(ctx, ticket.ticket_id, result);

  // LLD_v2 §5: "open → in_progress (first triage or agent opens it)" and
  // "customer_replied → in_progress (agent re-runs pipeline)". Any other
  // status (in_progress itself, awaiting_customer, resolved, closed) is left
  // alone — re-triage is always allowed (HLD invariant #9 comment in
  // tickets.ts) but doesn't force a status change from those states.
  if (canTransition(ticket.status, "in_progress")) {
    await updateTicketStatus(ctx, ticket.ticket_id, "in_progress");
  }
  await insertAgentRun(ctx, {
    run_id: runId,
    ticket_id: ticket.ticket_id,
    run_type: "triage",
    status: "completed",
    retrieved_doc_ids: [],
    tool_calls: [],
    guardrail_results: guardrailResults,
    model_provider: modelProvider,
    model_name: modelName,
    latency_ms: latencyMs,
  });

  return { status: "completed", result, runId };
}
