// V4-20 (LLD_v4 §7): CustomerVerifyRequest's exactly-one-of refinement.
// Tested at the schema level rather than through POST /customer-auth/verify
// so it doesn't compete with that route's tight 5/hour/IP rate-limit budget
// (see tests/e2e/customerAuth.test.ts) — this is pure validation logic with
// no DB dependency either way.
import { describe, expect, it } from "vitest";
import { CustomerVerifyRequest } from "../../src/domain/authTypes.js";

describe("CustomerVerifyRequest", () => {
  it("accepts an order-scoped request", () => {
    const result = CustomerVerifyRequest.safeParse({
      org_slug: "default",
      email: "aisha.rao@example.com",
      order_id: "ord_5001",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a ticket-scoped request", () => {
    const result = CustomerVerifyRequest.safeParse({
      org_slug: "default",
      email: "aisha.rao@example.com",
      ticket_id: "tkt_9001",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a request with neither order_id nor ticket_id", () => {
    const result = CustomerVerifyRequest.safeParse({
      org_slug: "default",
      email: "aisha.rao@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a request with both order_id and ticket_id", () => {
    const result = CustomerVerifyRequest.safeParse({
      org_slug: "default",
      email: "aisha.rao@example.com",
      order_id: "ord_5001",
      ticket_id: "tkt_9001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = CustomerVerifyRequest.safeParse({
      org_slug: "default",
      email: "not-an-email",
      order_id: "ord_5001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing org_slug", () => {
    const result = CustomerVerifyRequest.safeParse({
      email: "aisha.rao@example.com",
      order_id: "ord_5001",
    });
    expect(result.success).toBe(false);
  });
});
