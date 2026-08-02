// V5-15 (LLD_v5 §6): every test in this suite that reaches an EmailAdapter
// reaches this one — never a real network call.
import { describe, expect, it } from "vitest";
import { MockEmailAdapter } from "../../../src/adapters/mockEmail.js";

describe("MockEmailAdapter", () => {
  it("records a sent message without touching the network", async () => {
    const adapter = new MockEmailAdapter();
    await adapter.send({ to: "customer@example.com", subject: "Your link", text: "click here" });
    expect(adapter.sent).toHaveLength(1);
    expect(adapter.sent[0]).toEqual({ to: "customer@example.com", subject: "Your link", text: "click here" });
  });

  it("accumulates multiple sends in order", async () => {
    const adapter = new MockEmailAdapter();
    await adapter.send({ to: "a@example.com", subject: "first", text: "1" });
    await adapter.send({ to: "b@example.com", subject: "second", text: "2" });
    expect(adapter.sent.map((m) => m.subject)).toEqual(["first", "second"]);
  });
});
