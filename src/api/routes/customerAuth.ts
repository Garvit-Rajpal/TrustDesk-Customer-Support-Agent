import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { CustomerVerifyRequest, MagicLinkRequest, MagicLinkConsumeRequest } from "../../domain/authTypes.js";
import { getOrgBySlug } from "../../db/repos/orgsRepo.js";
import { getCustomerByEmail, getCustomerById } from "../../db/repos/customersRepo.js";
import { getOrderById } from "../../db/repos/ordersRepo.js";
import { getTicketById } from "../../db/repos/ticketsRepo.js";
import {
  countRecentLinksForCustomer,
  findValidMagicLinkByTokenHash,
  insertMagicLink,
  markMagicLinkConsumed,
} from "../../db/repos/customerMagicLinksRepo.js";
import { newMagicLinkId } from "../../domain/ids.js";
import { signCustomerToken } from "../../services/tokens.js";
import type { EmailAdapter } from "../../adapters/emailAdapter.js";
import { MockEmailAdapter } from "../../adapters/mockEmail.js";
import { sendError } from "../errorEnvelope.js";

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

// V5-19 (LLD_v5 §6, HLD_v5 ADR-29): mirrors customerVerifyRateLimiter's
// 5/hour/IP exactly — the per-customer abuse guard below is the *second*,
// independent layer this route adds on top of it.
const magicLinkRequestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, "RATE_LIMITED", "Too many link requests — try again later");
  },
});

// Token-guessing against 256 bits of entropy is computationally infeasible,
// but throttled anyway for consistency with the rest of this surface.
const magicLinkConsumeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    sendError(res, "RATE_LIMITED", "Too many attempts — try again later");
  },
});

// Every failure path (unknown org slug, unknown email, or a known email with
// a mismatched order/ticket) responds with this exact same generic 401 — no
// field indicates which part failed, closing the enumeration channel.
function fail(res: import("express").Response): void {
  sendError(res, "UNAUTHENTICATED", "Verification failed");
}

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const MAGIC_LINK_SESSION_EXPIRY = "30d";
// Anti-abuse guard threshold (LLD_v5 §6): silently skip sending a new email
// once a customer already has this many non-expired/non-consumed links
// outstanding in the trailing window — still returns the identical generic
// 200, same non-enumeration posture as everything else on this response.
const MAGIC_LINK_ABUSE_THRESHOLD = 3;
const MAGIC_LINK_ABUSE_WINDOW_MINUTES = 60;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// V5-15..21 (LLD_v5 §6, HLD_v5 ADR-29): factory-built like buildTicketsRouter
// — the magic-link routes need an EmailAdapter, and this keeps
// `customerAuthRouter` importable without one for every existing test/route
// that only exercises /verify. Defaults to MockEmailAdapter so no test can
// ever reach a real email provider by omission (same guarantee app.ts's
// `export const app` already gives every other adapter).
export function buildCustomerAuthRouter(emailAdapter: EmailAdapter = new MockEmailAdapter()): Router {
  const customerAuthRouter = Router();

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

  // V5-19: always returns the identical generic 200 — whether or not the
  // email matched, whether or not the per-customer abuse guard tripped,
  // whether or not the email adapter call itself throws (best-effort send,
  // logged loudly server-side since a genuinely failed send has a real UX
  // cost, but never surfaced in the response shape).
  customerAuthRouter.post("/magic-link/request", magicLinkRequestRateLimiter, async (req, res, next) => {
    try {
      const parsed = MagicLinkRequest.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, "VALIDATION_ERROR", "Invalid magic-link request", parsed.error.flatten());
        return;
      }
      const { org_slug, email, ticket_id } = parsed.data;

      const org = await getOrgBySlug(org_slug);
      const ctx = org ? { org_id: org.org_id } : null;
      const customer = ctx ? await getCustomerByEmail(ctx, email) : null;

      let resolvedTicketId: string | undefined;
      if (ctx && customer && ticket_id) {
        const ticket = await getTicketById(ctx, ticket_id);
        if (ticket && ticket.customer_id === customer.customer_id) {
          resolvedTicketId = ticket.ticket_id;
        }
      }

      if (ctx && customer) {
        const recentCount = await countRecentLinksForCustomer(customer.customer_id, MAGIC_LINK_ABUSE_WINDOW_MINUTES);
        if (recentCount < MAGIC_LINK_ABUSE_THRESHOLD) {
          const rawToken = randomBytes(32).toString("hex");
          await insertMagicLink(ctx, {
            link_id: newMagicLinkId(),
            customer_id: customer.customer_id,
            ticket_id: resolvedTicketId,
            token_hash: hashToken(rawToken),
            expires_at: new Date(Date.now() + MAGIC_LINK_TTL_MS),
          });

          const portalBaseUrl = process.env.PORTAL_BASE_URL ?? "http://localhost:5173";
          const link = `${portalBaseUrl}/portal/magic-link?token=${rawToken}`;
          try {
            await emailAdapter.send({
              to: email,
              subject: "Your TrustDesk sign-in link",
              text: `Use this link to access your support conversation: ${link}\n\nThis link expires in 15 minutes and can only be used once.`,
              html: `<p>Use this link to access your support conversation:</p><p><a href="${link}">${link}</a></p><p>This link expires in 15 minutes and can only be used once.</p>`,
            });
          } catch (sendErr) {
            console.error("[trustdesk] magic-link email send failed:", sendErr);
          }
        }
      }

      res.status(200).json({ data: { ok: true } });
    } catch (err) {
      next(err);
    }
  });

  // V5-20: unlike /verify's failure message, this one is deliberately more
  // specific — there is no enumeration risk in telling a token-*holder*
  // their token is stale, unlike telling an email-*guesser* whether that
  // email exists.
  customerAuthRouter.post("/magic-link/consume", magicLinkConsumeRateLimiter, async (req, res, next) => {
    try {
      const parsed = MagicLinkConsumeRequest.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, "VALIDATION_ERROR", "Invalid magic-link consume request", parsed.error.flatten());
        return;
      }

      const link = await findValidMagicLinkByTokenHash(hashToken(parsed.data.token));
      if (!link) {
        sendError(res, "UNAUTHENTICATED", "Link expired or already used");
        return;
      }

      // The find above already excludes expired/consumed rows, but a
      // concurrent request could win the consume race between the find and
      // here — markMagicLinkConsumed's own WHERE consumed_at IS NULL guard
      // is the actual single-winner boundary; a losing request must not
      // mint a token even though its own `find` briefly saw a valid row.
      const consumed = await markMagicLinkConsumed(link.link_id);
      if (!consumed) {
        sendError(res, "UNAUTHENTICATED", "Link expired or already used");
        return;
      }

      const customerRow = await getCustomerById({ org_id: link.org_id }, link.customer_id);

      const customer_token = signCustomerToken(
        {
          customer_id: link.customer_id,
          org_id: link.org_id,
          ticket_id: link.ticket_id ?? undefined,
          kind: "customer",
        },
        { expiresIn: MAGIC_LINK_SESSION_EXPIRY }
      );

      res.status(200).json({
        data: {
          customer_token,
          customer: { customer_id: link.customer_id, name: customerRow?.name ?? "" },
          ticket_id: link.ticket_id ?? undefined,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return customerAuthRouter;
}
