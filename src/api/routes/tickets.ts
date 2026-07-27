import { Router } from "express";
import { CreateTicketRequest } from "../../domain/ticketTypes.js";
import { newTicketId } from "../../domain/ids.js";
import { getTicketById, listTickets, insertTicket } from "../../db/repos/ticketsRepo.js";
import { getCustomerById } from "../../db/repos/customersRepo.js";
import { getOrderById } from "../../db/repos/ordersRepo.js";
import { sendError } from "../errorEnvelope.js";

export const ticketsRouter = Router();

// LLD §4.4: list returns ticket summaries + triage-if-present. Expected
// labels never appear here (separate table, no join — HLD invariant #4).
ticketsRouter.get("/", async (req, res, next) => {
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
ticketsRouter.get("/:id", async (req, res, next) => {
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
ticketsRouter.post("/", async (req, res, next) => {
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
        sendError(res, "VALIDATION_ERROR", `order_id ${order_id} does not belong to customer_id ${customer_id}`);
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

    res.status(201).json({ data: ticket });
  } catch (err) {
    next(err);
  }
});
