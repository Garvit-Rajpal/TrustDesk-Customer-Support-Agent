// TicketThreadService (LLD_v2 §5, ADR-10). Orchestrates the status machine
// (services/ticketStatus.ts) around the thread-mutating actions: a customer
// reply, sending a draft, resolving, closing. Every transition goes through
// canTransition() — an illegal one is surfaced as a typed outcome, never a
// thrown exception, so the route layer can turn it into a 409 the same way
// ToolActionService's "illegal_transition" outcome does.
import type { Ticket } from "../domain/entities.js";
import type { OrgContext } from "../domain/orgContext.js";
import type { DraftRow } from "../db/repos/draftsRepo.js";
import { updateDraftStatus } from "../db/repos/draftsRepo.js";
import { updateTicketStatus } from "../db/repos/ticketsRepo.js";
import { insertMessage, type TicketMessageRow } from "../db/repos/ticketMessagesRepo.js";
import { newMessageId } from "../domain/ids.js";
import { canTransition } from "./ticketStatus.js";

export type ThreadOutcome =
  | { kind: "illegal_transition"; from: string }
  | { kind: "ok"; message: TicketMessageRow };

export type StatusOutcome = { kind: "illegal_transition"; from: string } | { kind: "ok" };

// LLD_v2 §5: "appends inbound msg, status → customer_replied".
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
  return { kind: "ok", message };
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
  return { kind: "ok", message };
}

export async function resolveTicket(ctx: OrgContext, ticket: Ticket): Promise<StatusOutcome> {
  if (!canTransition(ticket.status, "resolved")) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  await updateTicketStatus(ctx, ticket.ticket_id, "resolved");
  return { kind: "ok" };
}

export async function closeTicket(ctx: OrgContext, ticket: Ticket): Promise<StatusOutcome> {
  if (!canTransition(ticket.status, "closed")) {
    return { kind: "illegal_transition", from: ticket.status };
  }
  await updateTicketStatus(ctx, ticket.ticket_id, "closed");
  return { kind: "ok" };
}
