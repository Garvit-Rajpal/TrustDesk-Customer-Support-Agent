import { Router } from "express";
import rateLimit from "express-rate-limit";
import { CustomerVerifyRequest } from "../../domain/authTypes.js";
import { getOrgBySlug } from "../../db/repos/orgsRepo.js";
import { getCustomerByEmail } from "../../db/repos/customersRepo.js";
import { getOrderById } from "../../db/repos/ordersRepo.js";
import { getTicketById } from "../../db/repos/ticketsRepo.js";
import { signCustomerToken } from "../../services/tokens.js";
import { sendError } from "../errorEnvelope.js";

export const customerAuthRouter = Router();

// W17 (LLD_v4 §7, HLD_v4 ADR-23): stricter than /signup's 10/hour/IP — this
// route accepts an email+identifier guess shape open to enumeration.
const customerVerifyRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, "RATE_LIMITED", "Too many verification attempts — try again later");
  },
});

// Every failure path (unknown org slug, unknown email, or a known email with
// a mismatched order/ticket) responds with this exact same generic 401 — no
// field indicates which part failed, closing the enumeration channel.
function fail(res: import("express").Response): void {
  sendError(res, "UNAUTHENTICATED", "Verification failed");
}

customerAuthRouter.post("/verify", customerVerifyRateLimiter, async (req, res, next) => {
  try {
    const parsed = CustomerVerifyRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "Invalid verification request", parsed.error.flatten());
      return;
    }
    const { org_slug, email, order_id, ticket_id } = parsed.data;

    const org = await getOrgBySlug(org_slug);
    if (!org) {
      fail(res);
      return;
    }
    const ctx = { org_id: org.org_id };

    const customer = await getCustomerByEmail(ctx, email);
    if (!customer) {
      fail(res);
      return;
    }

    let resolvedTicketId: string | undefined;
    if (order_id) {
      const order = await getOrderById(ctx, order_id);
      if (!order || order.customer_id !== customer.customer_id) {
        fail(res);
        return;
      }
    } else {
      const ticket = await getTicketById(ctx, ticket_id!);
      if (!ticket || ticket.customer_id !== customer.customer_id) {
        fail(res);
        return;
      }
      resolvedTicketId = ticket.ticket_id;
    }

    const customer_token = signCustomerToken({
      customer_id: customer.customer_id,
      org_id: org.org_id,
      ticket_id: resolvedTicketId,
      kind: "customer",
    });

    res.status(200).json({
      data: {
        customer_token,
        customer: { customer_id: customer.customer_id, name: customer.name },
        ticket_id: resolvedTicketId,
      },
    });
  } catch (err) {
    next(err);
  }
});
