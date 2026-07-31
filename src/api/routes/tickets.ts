import { Router, type Response } from "express";
import { CreateTicketRequest, ManualReplyRequest, SimulateInboundRequest } from "../../domain/ticketTypes.js";
import { getTicketById, listTickets } from "../../db/repos/ticketsRepo.js";
import { getCustomerById } from "../../db/repos/customersRepo.js";
import { getOrderById } from "../../db/repos/ordersRepo.js";
import { listMessagesByTicketId } from "../../db/repos/ticketMessagesRepo.js";
import { sendError } from "../errorEnvelope.js";
import type { ModelAdapter } from "../../adapters/modelAdapter.js";
import type { EmbeddingAdapter } from "../../adapters/embeddingAdapter.js";
import { runTriage } from "../../services/triage.js";
import { generateDraft } from "../../services/draft.js";
import { closeTicket, resolveTicket, sendManualReply, simulateInbound } from "../../services/ticketThread.js";
import { createTicketWithPipeline, autoSendIfEligible } from "../../services/ticketIntake.js";
import { getAgentRunById } from "../../db/repos/agentRunsRepo.js";
import { listRunEventsByRunId } from "../../db/repos/runEventsRepo.js";
import { isTerminalEvent, pipelineEventBus } from "../../services/events/pipelineEventBus.js";
import type { RunEvent } from "../../domain/schemas.js";
import { requirePermission } from "../middleware/permissions.js";

// Factory rather than a module-level Router: the triage route needs a
// ModelAdapter, and tests must be able to inject a MockModelAdapter with
// scenario-specific canned responses (LLD §1) instead of the app's shared
// default instance. V4-12: embeddingAdapter follows the same pattern for
// resolveTicket()'s ingestion hook.
export function buildTicketsRouter(modelAdapter: ModelAdapter, embeddingAdapter: EmbeddingAdapter): Router {
  const ticketsRouter = Router();

  // LLD §4.4: list returns ticket summaries + triage-if-present. Expected
  // labels never appear here (separate table, no join — HLD invariant #4).
  ticketsRouter.get("/", requirePermission("tickets:view"), async (req, res, next) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const category = typeof req.query.category === "string" ? req.query.category : undefined;
      const tickets = await listTickets(req.orgContext!, { status, category });
      res.status(200).json({ data: { tickets } });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.4: fetch returns { ticket, customer, order }.
  ticketsRouter.get("/:id", requirePermission("tickets:view"), async (req, res, next) => {
    try {
      const ticket = await getTicketById(req.orgContext!, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const customer = await getCustomerById(req.orgContext!, ticket.customer_id);
      const order = ticket.order_id ? await getOrderById(req.orgContext!, ticket.order_id) : null;
      res.status(200).json({ data: { ticket, customer, order } });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.5: create ticket (demo). FK validation → 400. body stored
  // verbatim. W17 (LLD_v4 §7, V4-21): the greeting -> triage -> draft ->
  // auto-send orchestration itself is extracted into
  // createTicketWithPipeline() — this handler now only does request
  // validation and translates the typed outcome into the same HTTP
  // responses it always returned.
  ticketsRouter.post("/", requirePermission("tickets:write"), async (req, res, next) => {
    try {
      const parsed = CreateTicketRequest.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, "VALIDATION_ERROR", "Invalid ticket payload", parsed.error.flatten());
        return;
      }

      const outcome = await createTicketWithPipeline(req.orgContext!, modelAdapter, embeddingAdapter, parsed.data);
      if (outcome.kind === "invalid_customer") {
        sendError(res, "VALIDATION_ERROR", `customer_id ${outcome.customer_id} does not exist`);
        return;
      }
      if (outcome.kind === "invalid_order") {
        sendError(res, "VALIDATION_ERROR", `order_id ${outcome.order_id} does not exist`);
        return;
      }
      if (outcome.kind === "order_customer_mismatch") {
        sendError(
          res,
          "VALIDATION_ERROR",
          `order_id ${outcome.order_id} does not belong to customer_id ${outcome.customer_id}`
        );
        return;
      }

      res.status(201).json({ data: { ...outcome.ticket, pipeline: outcome.pipeline } });
    } catch (err) {
      next(err);
    }
  });

  // LLD §4.6: run triage. No body. 409 is NOT used here — re-triage is
  // allowed (draft-reply is what requires prior triage, HLD invariant #9).
  ticketsRouter.post("/:id/triage", requirePermission("tickets:triage"), async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const ticket = await getTicketById(ctx, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const customer = await getCustomerById(ctx, ticket.customer_id);
      const order = ticket.order_id ? await getOrderById(ctx, ticket.order_id) : null;

      const outcome = await runTriage(ctx, modelAdapter, ticket, customer!, order);

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
      const ctx = req.orgContext!;
      const ticket = await getTicketById(ctx, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      if (!ticket.triage) {
        sendError(res, "CONFLICT", `Ticket ${req.params.id} must be triaged before drafting a reply`);
        return;
      }
      // V3-4 (LLD_v3 §3, HLD_v3 ADR-15): one-way — once a human has taken
      // over, AI drafting never re-enters this ticket.
      if (ticket.human_owned) {
        sendError(res, "CONFLICT", `Ticket ${req.params.id} is human-owned; AI drafting is disabled`);
        return;
      }
      const customer = await getCustomerById(ctx, ticket.customer_id);
      const order = ticket.order_id ? await getOrderById(ctx, ticket.order_id) : null;

      const outcome = await generateDraft(ctx, modelAdapter, ticket, customer!, order, embeddingAdapter, modelAdapter);
      // V3-5 (LLD_v3 §3, HLD_v3 ADR-15): same eligibility check the
      // ticket-creation auto-pipeline uses below — auto-send behaves
      // identically whether triage/draft were triggered by ticket creation
      // or by an agent manually clicking draft-reply.
      const autoSent = await autoSendIfEligible(ctx, ticket, outcome, req.user!.sub);

      res.status(200).json({
        data: {
          draft_id: outcome.draftId,
          ticket_id: ticket.ticket_id,
          resolution_type: outcome.resolutionType,
          body: outcome.body,
          citations: outcome.citations,
          recommended_actions: outcome.recommendedActions,
          run_id: outcome.runId,
          auto_sent: autoSent,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // V2-4 (LLD_v2 §5): full thread, ordered.
  ticketsRouter.get("/:id/messages", requirePermission("tickets:messages:view"), async (req, res, next) => {
    try {
      const ctx = req.orgContext!;
      const ticket = await getTicketById(ctx, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const messages = await listMessagesByTicketId(ctx, ticket.ticket_id);
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
        const ctx = req.orgContext!;
        const ticket = await getTicketById(ctx, req.params.id);
        if (!ticket) {
          sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
          return;
        }

        const outcome = await simulateInbound(ctx, ticket, parsed.data.body);
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

  // V3-4 (LLD_v3 §3, HLD_v3 ADR-15): human takeover — a manually-typed
  // reply that bypasses the draft pipeline entirely. Marks the ticket
  // human_owned (idempotent past the first call).
  ticketsRouter.post(
    "/:id/messages/reply",
    requirePermission("tickets:reply_manual"),
    async (req, res, next) => {
      try {
        const parsed = ManualReplyRequest.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, "VALIDATION_ERROR", "Invalid manual reply payload", parsed.error.flatten());
          return;
        }
        const ctx = req.orgContext!;
        const ticket = await getTicketById(ctx, req.params.id);
        if (!ticket) {
          sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
          return;
        }

        const outcome = await sendManualReply(ctx, ticket, parsed.data.body, req.user!.sub);
        if (outcome.kind === "illegal_transition") {
          sendError(
            res,
            "CONFLICT",
            `Ticket is "${outcome.from}" — a reply is only valid from "in_progress" or "customer_replied"`
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
      const ctx = req.orgContext!;
      const ticket = await getTicketById(ctx, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const outcome = await resolveTicket(ctx, ticket, embeddingAdapter);
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
      const ctx = req.orgContext!;
      const ticket = await getTicketById(ctx, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }
      const outcome = await closeTicket(ctx, ticket);
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
      const ctx = req.orgContext!;
      const ticket = await getTicketById(ctx, req.params.id);
      if (!ticket) {
        sendError(res, "NOT_FOUND", `Ticket ${req.params.id} not found`);
        return;
      }

      const run = await getAgentRunById(ctx, req.params.runId);
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
