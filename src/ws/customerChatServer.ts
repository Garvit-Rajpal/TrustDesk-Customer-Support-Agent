// W17 (LLD_v4 §7): the customer-facing chat transport. Attached to the
// *raw* http.Server (server.ts only — app.ts/the exported `app` every test
// imports stays HTTP-only, so this module is never reachable from a test
// that only touches `app`).
//
// V4-23 (LLD_v4 §7): live delivery is split across two mechanisms —
// (1) a per-ticket subscription (customerThreadBus) that fires whenever
// sendDraft()/sendManualReply() produces a sent-status outbound message,
// covering both an auto-send from this connection's own triggered pipeline
// and a later, out-of-band human reply; (2) a synchronous check of the
// pipeline's own returned summary (runIntakePipeline()'s PipelineSummary)
// right after triggering it, to push the generic "a specialist will
// respond" status frame when draft succeeded but auto-send didn't fire.
// Never the pending/escalated draft body or its guardrail outcome — this
// module only ever reads PipelineSummary's booleans, never DraftOutcome.
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { Ticket } from "../domain/entities.js";
import type { ModelAdapter } from "../adapters/modelAdapter.js";
import type { EmbeddingAdapter } from "../adapters/embeddingAdapter.js";
import { verifyCustomerToken } from "../services/tokens.js";
import { getTicketById } from "../db/repos/ticketsRepo.js";
import { getCustomerById } from "../db/repos/customersRepo.js";
import { getOrderById } from "../db/repos/ordersRepo.js";
import { listMessagesByTicketId, type TicketMessageRow } from "../db/repos/ticketMessagesRepo.js";
import { createTicketWithPipeline, runIntakePipeline } from "../services/ticketIntake.js";
import { receiveCustomerMessage } from "../services/ticketThread.js";
import { subscribeSentMessages } from "../services/events/customerThreadBus.js";

// Custom WS close code (4000-4999 range is reserved for application use) —
// distinguishes "your token didn't verify" from a normal/abnormal socket
// close on the client.
const CLOSE_INVALID_TOKEN = 4001;

const AWAITING_SPECIALIST_TEXT = "a support specialist will respond shortly";

interface InboundFrame {
  body?: unknown;
}

export function attachCustomerChatServer(
  httpServer: HttpServer,
  modelAdapter: ModelAdapter,
  embeddingAdapter: EmbeddingAdapter
): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/customer-chat" });

  wss.on("connection", (ws: WebSocket, req) => {
    void handleConnection(ws, req, modelAdapter, embeddingAdapter);
  });

  return wss;
}

function sendMessageFrame(ws: WebSocket, message: TicketMessageRow): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(
    JSON.stringify({
      type: "message",
      message_id: message.message_id,
      direction: message.direction,
      body: message.body,
      author: message.author,
      created_at: message.created_at,
    })
  );
}

function sendStatusFrame(ws: WebSocket, text: string): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type: "status", text }));
}

async function handleConnection(
  ws: WebSocket,
  req: { url?: string },
  modelAdapter: ModelAdapter,
  embeddingAdapter: EmbeddingAdapter
): Promise<void> {
  const url = new URL(req.url ?? "", "http://customer-chat.internal");
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close(CLOSE_INVALID_TOKEN, "Missing customer token");
    return;
  }

  let claims;
  try {
    claims = verifyCustomerToken(token);
  } catch {
    ws.close(CLOSE_INVALID_TOKEN, "Invalid or expired customer token");
    return;
  }

  const ctx = { org_id: claims.org_id };
  let ticketId = claims.ticket_id;
  let unsubscribe: (() => void) | undefined;

  function subscribeToTicket(id: string): void {
    unsubscribe?.();
    unsubscribe = subscribeSentMessages(id, (message) => sendMessageFrame(ws, message));
  }

  // Stateless reconnect (LLD_v4 §7): no server-side session survives a
  // dropped connection — a ticket-scoped token just replays the persisted
  // thread so the client can rebuild its view from scratch, then
  // subscribes so any *later* sent message (auto-sent or human) still
  // reaches this connection live.
  if (ticketId) {
    const ticket = await getTicketById(ctx, ticketId);
    if (ticket) {
      const messages = await listMessagesByTicketId(ctx, ticketId);
      for (const message of messages) {
        sendMessageFrame(ws, message);
      }
      subscribeToTicket(ticketId);
    }
  }

  ws.on("close", () => unsubscribe?.());

  ws.on("message", (data: Buffer) => {
    void handleClientMessage(data, ws, ctx, claims.customer_id, modelAdapter, embeddingAdapter, {
      get: () => ticketId,
      set: (id: string) => {
        ticketId = id;
        subscribeToTicket(id);
      },
    });
  });
}

async function handleClientMessage(
  data: Buffer,
  ws: WebSocket,
  ctx: { org_id: string },
  customerId: string,
  modelAdapter: ModelAdapter,
  embeddingAdapter: EmbeddingAdapter,
  ticketIdBox: { get: () => string | undefined; set: (id: string) => void }
): Promise<void> {
  let frame: InboundFrame;
  try {
    frame = JSON.parse(data.toString());
  } catch {
    return;
  }
  if (typeof frame.body !== "string" || frame.body.length === 0) {
    return;
  }
  const body = frame.body;

  const existingTicketId = ticketIdBox.get();
  if (!existingTicketId) {
    // onTicketCreated fires (synchronously) before the pipeline starts, so
    // ticketIdBox.set()'s subscribeToTicket() call is guaranteed to be
    // listening before an auto-send could possibly publish.
    const outcome = await createTicketWithPipeline(
      ctx,
      modelAdapter,
      embeddingAdapter,
      { customer_id: customerId, channel: "chat", subject: body.slice(0, 80), body },
      (ticket: Ticket) => ticketIdBox.set(ticket.ticket_id)
    );
    if (outcome.kind === "ok" && outcome.pipeline.draft && !outcome.pipeline.auto_sent) {
      sendStatusFrame(ws, AWAITING_SPECIALIST_TEXT);
    }
    return;
  }

  const ticket = await getTicketById(ctx, existingTicketId);
  if (!ticket) return;

  const outcome = await receiveCustomerMessage(ctx, ticket, body, customerId);
  if (outcome.kind !== "ok") return;

  const [customer, updatedTicket] = await Promise.all([
    getCustomerById(ctx, ticket.customer_id),
    getTicketById(ctx, existingTicketId),
  ]);
  if (!customer || !updatedTicket) return;
  const order = updatedTicket.order_id ? await getOrderById(ctx, updatedTicket.order_id) : null;

  const pipeline = await runIntakePipeline(ctx, modelAdapter, embeddingAdapter, updatedTicket, customer, order);
  if (pipeline.draft && !pipeline.auto_sent) {
    sendStatusFrame(ws, AWAITING_SPECIALIST_TEXT);
  }
}
