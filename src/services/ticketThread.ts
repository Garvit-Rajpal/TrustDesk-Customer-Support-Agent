// TicketThreadService (LLD_v2 §5, ADR-10). Orchestrates the status machine
// (services/ticketStatus.ts) around the thread-mutating actions: a customer
// reply, sending a draft, resolving, closing. Every transition goes through
// canTransition() — an illegal one is surfaced as a typed outcome, never a
// thrown exception, so the route layer can turn it into a 409 the same way
// ToolActionService's "illegal_transition" outcome does.
import type { Ticket } from "../domain/entities.js";
import type { OrgContext } from "../domain/orgContext.js";
import type { DraftRow } from "../db/repos/draftsRepo.js";
import { getLatestSentDraftByTicketId, updateDraftStatus } from "../db/repos/draftsRepo.js";
import { markHumanOwned, updateTicketStatus } from "../db/repos/ticketsRepo.js";
import { insertMessage, type TicketMessageRow } from "../db/repos/ticketMessagesRepo.js";
import { insertResolutionEmbedding } from "../db/repos/resolutionEmbeddingsRepo.js";
import { newEmbeddingId, newMessageId } from "../domain/ids.js";
import { canTransition } from "./ticketStatus.js";
import type { EmbeddingAdapter } from "../adapters/embeddingAdapter.js";
import { inputScan } from "./guardrails/inputScan.js";
import type { GuardrailResult } from "../domain/schemas.js";
import { publishSentMessage } from "./events/customerThreadBus.js";

export type ThreadOutcome =
  | { kind: "illegal_transition"; from: string }
  | { kind: "ok"; message: TicketMessageRow; l1Results?: GuardrailResult[] };

export type StatusOutcome = { kind: "illegal_transition"; from: string } | { kind: "ok" };

// LLD_v2 §5: "appends inbound msg, status → customer_replied". V4-14
// (LLD_v4 §6, HLD_v4 ADR-22): also runs inputScan() eagerly right after the
// insert, for early visibility independent of whichever pipeline stage the
// ticket is later re-triaged through. This does not change disposal logic
// at all — should_escalate override application stays inside runTriage(),
// which still separately calls inputScan() itself at pipeline time. The
// eager scan here is purely informational on the returned outcome.
export async function simulateInbound(
  ctx: OrgContext,
  ticket: Ticket,
  body: string
): Promise<ThreadOutcome> {
  if (!canTransition(ticket.status, "customer_replied")) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  const message = await insertMessage(ctx, {
    message_id: newMessageId(),
    ticket_id: ticket.ticket_id,
    direction: "inbound",
    body,
    author: "customer",
  });
  await updateTicketStatus(ctx, ticket.ticket_id, "customer_replied");
  const l1Results = inputScan(ticket.subject, body);
  return { kind: "ok", message, l1Results };
}

// W17 (LLD_v4 §7): structurally identical to simulateInbound() above — same
// status-transition check, same eager-L1 call from W16 — the only
// difference is `author` is the verified customer_id from the WS session's
// CustomerToken rather than the literal string "customer", preserving a
// distinction between an agent-simulated inbound message and one genuinely
// authored by a verified portal session.
export async function receiveCustomerMessage(
  ctx: OrgContext,
  ticket: Ticket,
  body: string,
  customerId: string
): Promise<ThreadOutcome> {
  if (!canTransition(ticket.status, "customer_replied")) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  const message = await insertMessage(ctx, {
    message_id: newMessageId(),
    ticket_id: ticket.ticket_id,
    direction: "inbound",
    body,
    author: customerId,
  });
  await updateTicketStatus(ctx, ticket.ticket_id, "customer_replied");
  const l1Results = inputScan(ticket.subject, body);
  return { kind: "ok", message, l1Results };
}

// LLD_v2 §5: "appends outbound message from draft, draft status → sent,
// ticket status → awaiting_customer".
export async function sendDraft(
  ctx: OrgContext,
  ticket: Ticket,
  draft: DraftRow,
  authorUserId: string
): Promise<ThreadOutcome> {
  if (!canTransition(ticket.status, "awaiting_customer")) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  const message = await insertMessage(ctx, {
    message_id: newMessageId(),
    ticket_id: ticket.ticket_id,
    direction: "outbound",
    body: draft.body,
    author: authorUserId,
    draft_id: draft.draft_id,
  });
  await updateDraftStatus(ctx, draft.draft_id, "sent");
  await updateTicketStatus(ctx, ticket.ticket_id, "awaiting_customer");
  // W17 (LLD_v4 §7, V4-23): a customer-chat WS connection open on this
  // ticket needs to see this the moment it's sent, whether it was
  // auto-sent or an agent clicked "send" manually.
  publishSentMessage(ticket.ticket_id, message);
  return { kind: "ok", message };
}

// V3-4 (LLD_v3 §3, HLD_v3 ADR-15): a human-composed reply that bypasses the
// draft pipeline entirely (draft_id: null, same as sendDraft's shape
// otherwise). The first call on a ticket marks it human_owned — permanent,
// until resolved/closed — which the draft-reply route checks to 409 any
// further AI drafting attempts on this thread.
//
// Deliberate exception to "every transition goes through canTransition()":
// the general v2 state machine only reaches awaiting_customer from
// in_progress — a customer_replied ticket must normally be re-triaged back
// to in_progress first, which forces the AI pipeline through a fresh triage
// before drafting again. A human taking over doesn't go through
// triage/draft at all, so requiring that same detour here is just friction
// with no safety benefit — a human can reply directly from either
// in_progress or customer_replied.
const MANUAL_REPLY_SOURCES: ReadonlyArray<Ticket["status"]> = ["in_progress", "customer_replied"];

export async function sendManualReply(
  ctx: OrgContext,
  ticket: Ticket,
  body: string,
  authorUserId: string
): Promise<ThreadOutcome> {
  if (!MANUAL_REPLY_SOURCES.includes(ticket.status)) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  const message = await insertMessage(ctx, {
    message_id: newMessageId(),
    ticket_id: ticket.ticket_id,
    direction: "outbound",
    body,
    author: authorUserId,
  });
  await updateTicketStatus(ctx, ticket.ticket_id, "awaiting_customer");
  await markHumanOwned(ctx, ticket.ticket_id, authorUserId);
  // W17 (LLD_v4 §7, V4-23): same reasoning as sendDraft() above — this is
  // the "a subsequently human-sent reply" half of "auto-sent or a
  // subsequently human-sent reply" a portal connection must receive live.
  publishSentMessage(ticket.ticket_id, message);
  return { kind: "ok", message };
}

// V4-12 (LLD_v4 §5, HLD_v4 ADR-21): embeddingAdapter is optional so every
// existing caller/test keeps working unchanged — buildTicketsRouter always
// supplies one in the real app (mirrors MockModelAdapter's "always present
// in tests" rule, extended to embeddings).
export async function resolveTicket(
  ctx: OrgContext,
  ticket: Ticket,
  embeddingAdapter?: EmbeddingAdapter
): Promise<StatusOutcome> {
  if (!canTransition(ticket.status, "resolved")) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  await updateTicketStatus(ctx, ticket.ticket_id, "resolved");
  if (embeddingAdapter) {
    await ingestResolutionEmbedding(ctx, ticket, embeddingAdapter);
  }
  return { kind: "ok" };
}

// Best-effort — never fails the resolve action itself (the ticket row and
// status transition are already committed by the time this runs). Only
// ever reads real tickets/drafts rows via getLatestSentDraftByTicketId;
// never data/eval_cases.jsonl or ticket_expected_labels — the eval runner
// calls runTriage()/generateDraft() directly and never resolveTicket() at
// all, so eval fixtures can't reach this path structurally (invariant #4's
// spirit, HLD_v4 ADR-21). Skips silently if there's no sent draft — a
// purely human-owned resolution with zero AI drafts has nothing to embed.
async function ingestResolutionEmbedding(
  ctx: OrgContext,
  ticket: Ticket,
  embeddingAdapter: EmbeddingAdapter
): Promise<void> {
  try {
    const draft = await getLatestSentDraftByTicketId(ctx, ticket.ticket_id);
    if (!draft) return;

    const triage = ticket.triage as { category?: unknown } | null;
    const category = triage && typeof triage.category === "string" ? triage.category : "unknown";

    const embedding = await embeddingAdapter.embed(draft.body);
    await insertResolutionEmbedding(ctx, {
      embedding_id: newEmbeddingId(),
      ticket_id: ticket.ticket_id,
      draft_id: draft.draft_id,
      category,
      resolution_type: draft.resolution_type,
      source_text: draft.body,
      embedding,
    });
  } catch (err) {
    console.warn(`[trustdesk] resolution-embedding ingestion failed for ${ticket.ticket_id}:`, err);
  }
}

export async function closeTicket(ctx: OrgContext, ticket: Ticket): Promise<StatusOutcome> {
  if (!canTransition(ticket.status, "closed")) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  await updateTicketStatus(ctx, ticket.ticket_id, "closed");
  return { kind: "ok" };
}
