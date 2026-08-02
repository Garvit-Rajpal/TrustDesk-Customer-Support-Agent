// W17 (LLD_v4 §7): pure extraction of the greeting -> triage -> draft ->
// auto-send orchestration that used to live inline in tickets.ts's POST /
// handler. Pulled out so the new customer-chat WS handler (customerChatServer.ts)
// can trigger the identical pipeline a portal-submitted first message goes
// through, without duplicating it. Behavior is unchanged — POST /tickets
// calls this and does nothing else pipeline-related itself.
import type { Ticket } from "../domain/entities.js";
import type { OrgContext } from "../domain/orgContext.js";
import type { CreateTicketRequest } from "../domain/ticketTypes.js";
import type { ModelAdapter } from "../adapters/modelAdapter.js";
import type { EmbeddingAdapter } from "../adapters/embeddingAdapter.js";
import { newMessageId, newTicketId } from "../domain/ids.js";
import { getTicketById, insertTicket } from "../db/repos/ticketsRepo.js";
import { getCustomerById } from "../db/repos/customersRepo.js";
import { getOrderById } from "../db/repos/ordersRepo.js";
import { getOrgById } from "../db/repos/orgsRepo.js";
import { insertMessage } from "../db/repos/ticketMessagesRepo.js";
import { getDraftById } from "../db/repos/draftsRepo.js";
import { greetingTemplate } from "./ticketGreeting.js";
import { runTriage } from "./triage.js";
import { generateDraft, evaluateAutoSend, type DraftOutcome } from "./draft.js";
import { sendDraft } from "./ticketThread.js";
import { postPipelineFailureFallback } from "./pipelineFailureFallback.js";

export type CreateTicketOutcome =
  | { kind: "invalid_customer"; customer_id: string }
  | { kind: "invalid_order"; order_id: string }
  | { kind: "order_customer_mismatch"; order_id: string; customer_id: string }
  | { kind: "ok"; ticket: Ticket; pipeline: PipelineSummary };

export interface PipelineSummary {
  triage: boolean;
  draft: boolean;
  auto_sent: boolean;
}

// V3-5 (LLD_v3 §3): shared by both the manual draft-reply route and the
// ticket-creation auto-pipeline below, so auto-send behaves identically
// regardless of what triggered the draft. Re-fetches the just-inserted
// DraftRow (generateDraft only returns a DraftOutcome) since sendDraft
// needs the full row shape.
export async function autoSendIfEligible(
  ctx: OrgContext,
  ticket: Ticket,
  outcome: DraftOutcome,
  authorUserId: string
): Promise<boolean> {
  if (!evaluateAutoSend(outcome)) {
    return false;
  }
  const draftRow = await getDraftById(ctx, outcome.draftId);
  if (!draftRow) {
    return false;
  }
  const sendOutcome = await sendDraft(ctx, ticket, draftRow, authorUserId);
  return sendOutcome.kind === "ok";
}

// V3-5 (LLD_v3 §3, HLD_v3 ADR-15) / W17 (LLD_v4 §7, V4-23): the triage ->
// draft -> auto-send sequence shared by ticket creation (below) and, as of
// W17, the customer-chat WS handler's response to a *subsequent* portal
// message (customerChatServer.ts, after receiveCustomerMessage()). A
// model/pipeline failure must never propagate — the caller's own write
// (ticket creation, or the inbound message insert) is already committed by
// the time this runs. Invariant #11 (once human_owned, AI drafting is
// permanently blocked) is enforced here directly rather than trusted to
// every caller, since this function — unlike the draft-reply *route* — has
// no HTTP layer above it to 409 first.
export async function runIntakePipeline(
  ctx: OrgContext,
  modelAdapter: ModelAdapter,
  embeddingAdapter: EmbeddingAdapter,
  ticket: Ticket,
  customer: Awaited<ReturnType<typeof getCustomerById>>,
  order: Awaited<ReturnType<typeof getOrderById>>
): Promise<PipelineSummary> {
  const pipeline: PipelineSummary = { triage: false, draft: false, auto_sent: false };
  if (!customer || ticket.human_owned) {
    return pipeline;
  }
  try {
    const triageOutcome = await runTriage(ctx, modelAdapter, ticket, customer, order);
    if (triageOutcome.status === "completed") {
      pipeline.triage = true;
      const triagedTicket = await getTicketById(ctx, ticket.ticket_id);
      if (triagedTicket) {
        const draftOutcome = await generateDraft(
          ctx,
          modelAdapter,
          triagedTicket,
          customer,
          order,
          embeddingAdapter,
          modelAdapter
        );
        pipeline.draft = true;
        pipeline.auto_sent = await autoSendIfEligible(ctx, triagedTicket, draftOutcome, "system");
      }
    }
  } catch {
    // Leave pipeline at its last-known-true state; the caller's own write
    // already succeeded and must be reported as such. If triage itself had
    // failed, runTriage() already posted its own fallback message and
    // advanced ticket status internally (see triage.ts) — this only needs
    // to cover an exception *after* a successful triage (draft generation
    // or auto-send throwing unexpectedly, not the graceful guardrail_blocked
    // fallback generateDraft() already returns on its own parse failure),
    // which would otherwise leave the same silent "customer got nothing"
    // gap this fix closes.
    if (pipeline.triage) {
      await postPipelineFailureFallback(ctx, ticket.ticket_id);
    }
  }
  return pipeline;
}

// LLD §4.5 / V3-4/V3-5 (HLD_v3 ADR-15): create ticket, seed the inbound
// thread message, best-effort greeting, then synchronously run
// runIntakePipeline() (HLD invariant #6: every AI run's agent_runs row is
// written before this resolves — no new async/background pattern). A
// model/pipeline failure after ticket creation must never fail ticket
// creation itself — the ticket + greeting are already committed by that
// point. `onTicketCreated`, if given, fires synchronously right after the
// ticket + its seed messages are committed and before the pipeline starts —
// W17's WS handler uses this to subscribe to this ticket's
// customerThreadBus channel *before* an auto-send could possibly publish to
// it, closing what would otherwise be a subscribe-after-publish race.
export async function createTicketWithPipeline(
  ctx: OrgContext,
  modelAdapter: ModelAdapter,
  embeddingAdapter: EmbeddingAdapter,
  request: CreateTicketRequest,
  onTicketCreated?: (ticket: Ticket) => void
): Promise<CreateTicketOutcome> {
  const { customer_id, order_id, channel, subject, body } = request;

  const customer = await getCustomerById(ctx, customer_id);
  if (!customer) {
    return { kind: "invalid_customer", customer_id };
  }

  let order = null as Awaited<ReturnType<typeof getOrderById>>;
  if (order_id) {
    order = await getOrderById(ctx, order_id);
    if (!order) {
      return { kind: "invalid_order", order_id };
    }
    if (order.customer_id !== customer_id) {
      return { kind: "order_customer_mismatch", order_id, customer_id };
    }
  }

  const ticket = await insertTicket(ctx, {
    ticket_id: newTicketId(),
    customer_id,
    order_id: order_id ?? null,
    channel,
    subject,
    body,
    created_at: new Date().toISOString(),
  });

  // V2-4 (LLD_v2 §1): every ticket needs an initial inbound thread
  // message — the draft pipeline always reads the thread, never
  // tickets.body directly (see backfill migration + seed loader for the
  // same rule applied to pre-existing tickets).
  await insertMessage(ctx, {
    message_id: newMessageId(),
    ticket_id: ticket.ticket_id,
    direction: "inbound",
    body: ticket.body,
    author: "customer",
  });

  // V3-4 (LLD_v3 §3, HLD_v3 ADR-15): deterministic, per-vertical
  // greeting — no model call, no status transition. Best-effort: an
  // org lookup failure here shouldn't fail ticket creation, which is
  // already committed by this point.
  const org = await getOrgById(ctx.org_id);
  if (org) {
    await insertMessage(ctx, {
      message_id: newMessageId(),
      ticket_id: ticket.ticket_id,
      direction: "outbound",
      body: greetingTemplate(org.vertical),
      author: "system",
    });
  }

  onTicketCreated?.(ticket);

  const pipeline = await runIntakePipeline(ctx, modelAdapter, embeddingAdapter, ticket, customer, order);

  return { kind: "ok", ticket, pipeline };
}
