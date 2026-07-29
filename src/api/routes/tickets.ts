import { Router, type Response } from "express";
import { CreateTicketRequest, SimulateInboundRequest } from "../../domain/ticketTypes.js";
import { newMessageId, newTicketId } from "../../domain/ids.js";
import { getTicketById, listTickets, insertTicket } from "../../db/repos/ticketsRepo.js";
import { getCustomerById } from "../../db/repos/customersRepo.js";
import { getOrderById } from "../../db/repos/ordersRepo.js";
import { insertMessage, listMessagesByTicketId } from "../../db/repos/ticketMessagesRepo.js";
import { sendError } from "../errorEnvelope.js";
import type { ModelAdapter } from "../../adapters/modelAdapter.js";
import { runTriage } from "../../services/triage.js";
import { generateDraft } from "../../services/draft.js";
import { closeTicket, resolveTicket, simulateInbound } from "../../services/ticketThread.js";
import { getAgentRunById } from "../../db/repos/agentRunsRepo.js";
import { listRunEventsByRunId } from "../../db/repos/runEventsRepo.js";
import { isTerminalEvent, pipelineEventBus } from "../../services/events/pipelineEventBus.js";
import type { RunEvent } from "../../domain/schemas.js";
import { requirePermission } from "../middleware/permissions.js";

// Factory rather than a module-level Router: the triage route needs a
// ModelAdapter, and tests must be able to inject a MockModelAdapter with
// scenario-specific canned responses (LLD §1) instead of the app's shared
// default instance.
export function buildTicketsRouter(modelAdapter: ModelAdapter): Router {
  const ticketsRouter = Router();

  // LLD §4.4: list returns ticket summaries + triage-if-present. Expected
  // labels never appear here (separate table, no join — HLD invariant #4).
  ticketsRouter.get("/", requirePermission("tickets:view"), async (req, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const tickets = await listTickets({ status, category });
      res.status(200).json({ data: { tickets } });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.4: fetch returns { ticket, customer, order }.
  ticketsRouter.get("/:id", requirePermission("tickets:view"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const customer = await getCustomerById(ticket.customer_id);
      const order = ticket.order_id ? await getOrderById(ticket.order_id) : null;
      res.status(200).json({ data: { ticket, customer, order } });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.5: create ticket (demo). FK validation → 400. body stored verbatim.
  ticketsRouter.post("/", requirePermission("tickets:write"), async (req, res, next) => {
    try {
      const parsed = CreateTicketRequest.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, "VALIDATION_ERROR", "Invalid ticket payload", parsed.error.flatten());
        return;
      }
      const { customer_id, order_id, channel, subject, body } = parsed.data;

      const customer = await getCustomerById(customer_id);
      if (!customer) {
        sendError(res, "VALIDATION_ERROR", `customer_id ${customer_id} does not exist`);
        return;
      }

      if (order_id) {
        const order = await getOrderById(order_id);
        if (!order) {
          sendError(res, "VALIDATION_ERROR", `order_id ${order_id} does not exist`);
          return;
        }
        if (order.customer_id !== customer_id) {
          sendError(
            res,
            "VALIDATION_ERROR",
            `order_id ${order_id} does not belong to customer_id ${customer_id}`
          );
          return;
        }
      }

      const ticket = await insertTicket({
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
      await insertMessage({
        message_id: newMessageId(),
        ticket_id: ticket.ticket_id,
        direction: "inbound",
        body: ticket.body,
        author: "customer",
      });

      res.status(201).json({ data: ticket });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.6: run triage. No body. 409 is NOT used here — re-triage is
  // allowed (draft-reply is what requires prior triage, HLD invariant #9).
  ticketsRouter.post("/:id/triage", requirePermission("tickets:triage"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const customer = await getCustomerById(ticket.customer_id);
      const order = ticket.order_id ? await getOrderById(ticket.order_id) : null;

      const outcome = await runTriage(modelAdapter, ticket, customer!, order);

      if (outcome.status === "failed") {
        sendError(res, "MODEL_PROVIDER_ERROR", outcome.error, { run_id: outcome.runId });
        return;
      }

      res.status(200).json({
        data: {
          ticket_id: ticket.ticket_id,
          category: outcome.result.category,
          priority: outcome.result.priority,
          sentiment: outcome.result.sentiment,
          should_escalate: outcome.result.should_escalate,
          reason_summary: outcome.result.reason_summary,
          run_id: outcome.runId,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.7: 409 if not yet triaged (HLD invariant #9: triage → retrieval →
  // draft). L3 fail-closed is NOT an HTTP error — 200 with the substituted
  // template draft, since the flow degraded safely rather than failing.
  ticketsRouter.post("/:id/draft-reply", requirePermission("tickets:draft"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      if (!ticket.triage) {
        sendError(res, "CONFLICT", `Ticket ${req.params.id} must be triaged before drafting a reply`);
        return;
      }
      const customer = await getCustomerById(ticket.customer_id);
      const order = ticket.order_id ? await getOrderById(ticket.order_id) : null;

      const outcome = await generateDraft(modelAdapter, ticket, customer!, order);

      res.status(200).json({
        data: {
          draft_id: outcome.draftId,
          ticket_id: ticket.ticket_id,
          resolution_type: outcome.resolutionType,
          body: outcome.body,
          citations: outcome.citations,
          recommended_actions: outcome.recommendedActions,
          run_id: outcome.runId,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // V2-4 (LLD_v2 §5): full thread, ordered.
  ticketsRouter.get("/:id/messages", requirePermission("tickets:messages:view"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const messages = await listMessagesByTicketId(ticket.ticket_id);
      res.status(200).json({ data: { messages } });
    } catch (err) {
      next(err);
    }
  });

  // V2-4 (LLD_v2 §5): demo/test control standing in for a real inbound
  // channel (v3) — appends an inbound message and transitions the ticket to
  // customer_replied. Illegal from the ticket's current status (e.g. it was
  // never sent a reply yet) → 409, same shape as ToolActionService's
  // illegal_transition outcome.
  ticketsRouter.post(
    "/:id/messages/simulate-inbound",
    requirePermission("tickets:simulate_inbound"),
    async (req, res, next) => {
      try {
        const parsed = SimulateInboundRequest.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, "VALIDATION_ERROR", "Invalid simulate-inbound payload", parsed.error.flatten());
          return;
        }
        const ticket = await getTicketById(req.params.id);
        if (!ticket) {
          sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
          return;
        }

        const outcome = await simulateInbound(ticket, parsed.data.body);
        if (outcome.kind === "illegal_transition") {
          sendError(
            res,
            "CONFLICT",
            `Ticket is "${outcome.from}" — a customer reply is only valid from "awaiting_customer" or "resolved"`
          );
          return;
        }
        res.status(201).json({ data: outcome.message });
      } catch (err) {
        next(err);
      }
    }
  );

  // LLD_v2 §5: human-only status transitions.
  ticketsRouter.post("/:id/resolve", requirePermission("tickets:resolve"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const outcome = await resolveTicket(ticket);
      if (outcome.kind === "illegal_transition") {
        sendError(res, "CONFLICT", `Ticket is "${outcome.from}" — cannot resolve from this status`);
        return;
      }
      res.status(200).json({ data: { ticket_id: ticket.ticket_id, status: "resolved" } });
    } catch (err) {
      next(err);
    }
  });

  ticketsRouter.post("/:id/close", requirePermission("tickets:resolve"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const outcome = await closeTicket(ticket);
      if (outcome.kind === "illegal_transition") {
        sendError(res, "CONFLICT", `Ticket is "${outcome.from}" — cannot close from this status`);
        return;
      }
      res.status(200).json({ data: { ticket_id: ticket.ticket_id, status: "closed" } });
    } catch (err) {
      next(err);
    }
  });

  // V2-1 (LLD_v2 §2, ADR-8): SSE pipeline visibility. Replays persisted
  // run_events first (identical shape for a historical or a still-running
  // run), then — if the run hasn't reached a terminal stage yet — subscribes
  // to the in-process PipelineEventBus and streams further events live,
  // closing once a terminal event arrives. In practice triage/draft finish
  // synchronously before their POST response returns (HLD invariant #6), so
  // a client only ever sees the replay path; the live path exists for
  // concurrent viewers that open the stream while a run is still executing.
  ticketsRouter.get("/:id/runs/:runId/events", requirePermission("runs:view"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }

      const run = await getAgentRunById(req.params.runId);
      if (run && run.ticket_id !== ticket.ticket_id) {
        sendError(res, "NOT_FOUND", `Run ${req.params.runId} not found for ticket ${ticket.ticket_id}`);
        return;
      }

      const persisted = await listRunEventsByRunId(req.params.runId);
      if (!run && persisted.length === 0) {
        sendError(res, "NOT_FOUND", `Run ${req.params.runId} not found`);
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

      if (run) {
        // Run already finished (agent_runs row exists) — nothing more will
        // ever be emitted for this run_id.
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

  return ticketsRouter;
}

function writeSseEvent(res: Response, stage: string, status: string, summary: unknown, ts: string): void {
  res.write(`data: ${JSON.stringify({ stage, status, summary, ts })}\n\n`);
}
