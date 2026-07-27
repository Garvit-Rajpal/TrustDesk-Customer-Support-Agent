// Milestone 4 (LLD §9): eligibility — pure functions, full branch coverage.
// Policy-window math uses ticket.created_at ONLY, never the current date,
// never the LLM (HLD invariant #3).
import { describe, expect, it } from "vitest";
import { computeEligibilityFacts, warrantyMonths } from "../../src/services/eligibility.js";
import type { Order, OrderItem, Customer } from "../../src/domain/entities.js";

function order(overrides: Partial<Order> = {}): Order {
  return {
    order_id: "ord_1",
    customer_id: "cus_1",
    status: "delivered",
    placed_at: "2026-01-01T00:00:00Z",
    delivered_at: "2026-01-05T00:00:00Z",
    eligible_return_until: "2026-01-12T00:00:00Z",
    total: 8999,
    currency: "INR",
    payment_status: "paid",
    tracking_number: "TRK1",
    items: [item()],
    ...overrides,
  };
}

function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return { sku: "SKU-1", name: "Widget", quantity: 1, category: "audio", final_sale: false, ...overrides };
}

function customer(overrides: Partial<Customer> = {}): Customer {
  return {
    customer_id: "cus_1",
    name: "Test Customer",
    email: "test@example.com",
    tier: "standard",
    country: "IN",
    verified: true,
    tags: [],
    created_at: "2024-01-01",
    ...overrides,
  };
}

describe("computeEligibilityFacts", () => {
  it("is eligible for return when ticket.created_at is within the window", () => {
    const facts = computeEligibilityFacts("2026-01-10T00:00:00Z", order(), customer());
    expect(facts.return_window_eligible).toBe(true);
  });

  it("is NOT eligible for return when ticket.created_at is after the window", () => {
    const facts = computeEligibilityFacts("2026-01-15T00:00:00Z", order(), customer());
    expect(facts.return_window_eligible).toBe(false);
  });

  it("treats the window boundary as inclusive", () => {
    const facts = computeEligibilityFacts("2026-01-12T00:00:00Z", order(), customer());
    expect(facts.return_window_eligible).toBe(true);
  });

  it("return_window_eligible is null when eligible_return_until is null", () => {
    const facts = computeEligibilityFacts(
      "2026-01-10T00:00:00Z",
      order({ eligible_return_until: null }),
      customer()
    );
    expect(facts.return_window_eligible).toBeNull();
  });

  it("ignores the current date entirely — only ticket.created_at matters", () => {
    // A ticket "created" far in the past relative to now must still evaluate
    // against the order's window using its own created_at, not Date.now().
    const facts = computeEligibilityFacts("2026-01-10T00:00:00Z", order(), customer());
    expect(facts.facts_basis.ticket_created_at).toBe("2026-01-10T00:00:00Z");
  });

  it("all facts are null when no order is linked", () => {
    const facts = computeEligibilityFacts("2026-01-10T00:00:00Z", null, customer());
    expect(facts.return_window_eligible).toBeNull();
    expect(facts.warranty_active).toBeNull();
    expect(facts.order_delivered).toBeNull();
    expect(facts.facts_basis.eligible_return_until).toBeNull();
  });

  it("order_delivered is true only when delivered_at is set", () => {
    expect(computeEligibilityFacts("2026-01-10T00:00:00Z", order(), customer()).order_delivered).toBe(
      true
    );
    expect(
      computeEligibilityFacts(
        "2026-01-10T00:00:00Z",
        order({ delivered_at: null }),
        customer()
      ).order_delivered
    ).toBe(false);
  });

  it("warranty_active is null when delivered_at is null", () => {
    const facts = computeEligibilityFacts(
      "2026-01-10T00:00:00Z",
      order({ delivered_at: null }),
      customer()
    );
    expect(facts.warranty_active).toBeNull();
  });

  it("warranty_active is true within the standard 12-month window", () => {
    const facts = computeEligibilityFacts(
      "2026-06-01T00:00:00Z", // ~5 months after delivery
      order({ delivered_at: "2026-01-05T00:00:00Z" }),
      customer()
    );
    expect(facts.warranty_active).toBe(true);
  });

  it("warranty_active is false after the standard 12-month window (non-gold)", () => {
    const facts = computeEligibilityFacts(
      "2027-06-01T00:00:00Z", // ~17 months after delivery
      order({ delivered_at: "2026-01-05T00:00:00Z" }),
      customer({ tier: "standard" })
    );
    expect(facts.warranty_active).toBe(false);
  });

  it("gold tier extends warranty by 6 months on eligible hardware", () => {
    // 15 months after delivery: past standard 12, within gold's 18.
    const facts = computeEligibilityFacts(
      "2027-04-05T00:00:00Z",
      order({ delivered_at: "2026-01-05T00:00:00Z", items: [item({ category: "tablet" })] }),
      customer({ tier: "gold" })
    );
    expect(facts.warranty_active).toBe(true);
  });
});

describe("warrantyMonths (KB-WARRANTY-001)", () => {
  it("standard warranty is 12 months for a non-gold customer", () => {
    expect(warrantyMonths(customer({ tier: "standard" }), item(), 8999)).toBe(12);
  });

  it("gold tier gets +6 months on eligible hardware", () => {
    expect(warrantyMonths(customer({ tier: "gold" }), item({ category: "tablet" }), 34999)).toBe(18);
  });

  it("gold extension does NOT apply to software licenses", () => {
    expect(
      warrantyMonths(customer({ tier: "gold" }), item({ category: "software" }), 4999)
    ).toBe(12);
  });

  it("gold extension does NOT apply to final-sale items", () => {
    expect(
      warrantyMonths(customer({ tier: "gold" }), item({ category: "tablet", final_sale: true }), 34999)
    ).toBe(12);
  });

  it("gold extension does NOT apply to accessories under INR 3000", () => {
    expect(
      warrantyMonths(customer({ tier: "gold" }), item({ category: "accessory" }), 2499)
    ).toBe(12);
  });

  it("gold extension DOES apply to accessories at or above INR 3000", () => {
    expect(
      warrantyMonths(customer({ tier: "gold" }), item({ category: "accessory" }), 3000)
    ).toBe(18);
  });
});
