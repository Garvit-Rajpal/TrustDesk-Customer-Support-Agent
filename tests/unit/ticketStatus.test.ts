// V2-4 (LLD_v2 §5/§9): "illegal transitions 409" — the state machine itself
// is a pure function, unit-tested on the documented transition table
// directly (same pattern as qualityMetrics.ts), no DB involved.
import { describe, expect, it } from "vitest";
import { canTransition } from "../../src/services/ticketStatus.js";

describe("canTransition", () => {
  const LEGAL: [string, string][] = [
    ["open", "in_progress"],
    ["in_progress", "awaiting_customer"],
    ["in_progress", "resolved"],
    ["awaiting_customer", "customer_replied"],
    ["awaiting_customer", "resolved"],
    ["customer_replied", "in_progress"],
    ["resolved", "closed"],
    ["resolved", "customer_replied"],
  ];

  it.each(LEGAL)("%s -> %s is legal", (from, to) => {
    expect(canTransition(from, to as any)).toBe(true);
  });

  const ILLEGAL: [string, string][] = [
    ["open", "resolved"],
    ["open", "customer_replied"],
    ["closed", "open"],
    ["closed", "in_progress"],
    ["awaiting_customer", "in_progress"],
    ["customer_replied", "awaiting_customer"],
    ["resolved", "in_progress"],
    ["resolved", "open"],
  ];

  it.each(ILLEGAL)("%s -> %s is illegal", (from, to) => {
    expect(canTransition(from, to as any)).toBe(false);
  });

  it("an unknown current status is never a legal source", () => {
    expect(canTransition("bogus_status", "open" as any)).toBe(false);
  });
});
