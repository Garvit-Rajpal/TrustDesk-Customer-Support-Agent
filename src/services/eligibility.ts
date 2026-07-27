// EligibilityService (HLD §3, LLD §3): pure, deterministic policy-window
// math. Always uses the TICKET's created_at — never Date.now(), never the
// LLM (HLD invariant #3). Facts are computed here and injected into the
// draft prompt as stated ground truth (LLD §6 template).
import type { Customer, Order, OrderItem } from "../domain/entities.js";
import { EligibilityFacts } from "../domain/schemas.js";

const STANDARD_WARRANTY_MONTHS = 12;
const GOLD_EXTENSION_MONTHS = 6;
const GOLD_ACCESSORY_EXTENSION_MIN_INR = 3000;

function addMonths(iso: string, months: number): Date {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// KB-WARRANTY-001: "Electronics have a 12-month limited warranty... Gold-tier
// customers receive a 6-month warranty extension on eligible hardware
// products. The extension does not apply to software licenses, accessories
// under INR 3000, or final-sale items."
//
// Seed order items have no per-item price field (only order.total, and every
// seed order has quantity 1) — orderTotal is used as the item-price proxy
// for the "accessories under INR 3000" rule. Documented in docs/PROGRESS.md.
export function warrantyMonths(customer: Customer, item: OrderItem, orderTotal: number): number {
  const isSoftware = item.category === "software";
  const isFinalSale = item.final_sale;
  const isCheapAccessory = item.category === "accessory" && orderTotal < GOLD_ACCESSORY_EXTENSION_MIN_INR;
  const excludedFromExtension = isSoftware || isFinalSale || isCheapAccessory;

  const eligibleForExtension = customer.tier === "gold" && !excludedFromExtension;
  return STANDARD_WARRANTY_MONTHS + (eligibleForExtension ? GOLD_EXTENSION_MONTHS : 0);
}

export function computeEligibilityFacts(
  ticketCreatedAt: string,
  order: Order | null,
  customer: Customer
): EligibilityFacts {
  if (!order) {
    return {
      return_window_eligible: null,
      warranty_active: null,
      order_delivered: null,
      facts_basis: { ticket_created_at: ticketCreatedAt, eligible_return_until: null },
    };
  }

  const ticketDate = new Date(ticketCreatedAt);

  const return_window_eligible =
    order.eligible_return_until == null ? null : ticketDate <= new Date(order.eligible_return_until);

  const order_delivered = order.delivered_at != null;

  let warranty_active: boolean | null = null;
  if (order.delivered_at != null) {
    const firstItem = order.items[0];
    const months = firstItem ? warrantyMonths(customer, firstItem, order.total) : STANDARD_WARRANTY_MONTHS;
    const warrantyEnd = addMonths(order.delivered_at, months);
    warranty_active = ticketDate <= warrantyEnd;
  }

  return EligibilityFacts.parse({
    return_window_eligible,
    warranty_active,
    order_delivered,
    facts_basis: {
      ticket_created_at: ticketCreatedAt,
      eligible_return_until: order.eligible_return_until,
    },
  });
}
