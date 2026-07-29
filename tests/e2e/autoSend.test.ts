// V3-5 (LLD_v3 §3, HLD_v3 ADR-15, invariant #10): evaluateAutoSend() is one
// shared eligibility check used identically whether triage/draft ran via the
// ticket-creation auto-pipeline or a manual draft-reply click. Covers both
// trigger paths and both auto-send outcomes (eligible vs. gated/escalated).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, buildApp } from "../../src/app.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("auto-send eligibility (V3-5)", () => {
  let token: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("manual draft-reply route", () => {
    it("auto-sends when resolution_type is answered and no recommended action requires approval (tkt_9002)", async () => {
      await request(app).post("/tickets/tkt_9002/triage").set("Authorization", `Bearer ${token}`);
      const draft = await request(app)
        .post("/tickets/tkt_9002/draft-reply")
        .set("Authorization", `Bearer ${token}`);
      expect(draft.status).toBe(200);
      expect(draft.body.data.auto_sent).toBe(true);

      const ticket = await request(app).get("/tickets/tkt_9002").set("Authorization", `Bearer ${token}`);
      expect(ticket.body.data.ticket.status).toBe("awaiting_customer");

      const messages = await request(app)
        .get("/tickets/tkt_9002/messages")
        .set("Authorization", `Bearer ${token}`);
      const outbound = messages.body.data.messages.filter((m: any) => m.direction === "outbound");
      expect(outbound).toHaveLength(1);
      expect(outbound[0]).toMatchObject({ draft_id: draft.body.data.draft_id, author: expect.any(String) });
    });

    it("does not auto-send when the recommended action requires human approval (tkt_9001)", async () => {
      await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${token}`);
      const draft = await request(app)
        .post("/tickets/tkt_9001/draft-reply")
        .set("Authorization", `Bearer ${token}`);
      expect(draft.status).toBe(200);
      expect(draft.body.data.auto_sent).toBe(false);

      const ticket = await request(app).get("/tickets/tkt_9001").set("Authorization", `Bearer ${token}`);
      expect(ticket.body.data.ticket.status).toBe("in_progress");
    });

    it("does not auto-send an escalated draft (tkt_9004)", async () => {
      await request(app).post("/tickets/tkt_9004/triage").set("Authorization", `Bearer ${token}`);
      const draft = await request(app)
        .post("/tickets/tkt_9004/draft-reply")
        .set("Authorization", `Bearer ${token}`);
      expect(draft.status).toBe(200);
      expect(draft.body.data.resolution_type).toBe("escalated");
      expect(draft.body.data.auto_sent).toBe(false);

      const ticket = await request(app).get("/tickets/tkt_9004").set("Authorization", `Bearer ${token}`);
      expect(ticket.body.data.ticket.status).toBe("in_progress");
    });

    it("does not auto-send a refused_by_policy draft (tkt_9003)", async () => {
      await request(app).post("/tickets/tkt_9003/triage").set("Authorization", `Bearer ${token}`);
      const draft = await request(app)
        .post("/tickets/tkt_9003/draft-reply")
        .set("Authorization", `Bearer ${token}`);
      expect(draft.status).toBe(200);
      expect(draft.body.data.resolution_type).toBe("refused_by_policy");
      expect(draft.body.data.auto_sent).toBe(false);
    });
  });

  describe("ticket-creation auto-pipeline", () => {
    // Fresh tickets get a random ticket_id (newTicketId()), so a MockModelAdapter
    // must fall back to a "*:triage"/"*:draft" wildcard scenario — no exact
    // ticket_id key can be pre-registered for an id that doesn't exist yet.
    it("auto-triages, auto-drafts, and auto-sends a simple eligible ticket end-to-end", async () => {
      const adapter = new MockModelAdapter({
        "*:triage": {
          content: JSON.stringify({
            category: "general",
            priority: "low",
            sentiment: "neutral",
            should_escalate: false,
            reason_summary: "Straightforward question, no policy concerns.",
          }),
        },
        "*:draft": {
          content: JSON.stringify({
            body: "Thanks for reaching out — here's the answer to your question.",
            citations: [],
            resolution_type: "answered",
            recommended_actions: [],
          }),
        },
      });
      const testApp = buildApp(adapter);
      const created = await request(testApp)
        .post("/tickets")
        .set("Authorization", `Bearer ${token}`)
        .send({ customer_id: "cus_1001", channel: "email", subject: "Quick question", body: "How do I track my order?" });

      expect(created.status).toBe(201);
      expect(created.body.data.pipeline).toEqual({ triage: true, draft: true, auto_sent: true });

      const ticket = await request(testApp)
        .get(`/tickets/${created.body.data.ticket_id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(ticket.body.data.ticket.status).toBe("awaiting_customer");

      const messages = await request(testApp)
        .get(`/tickets/${created.body.data.ticket_id}/messages`)
        .set("Authorization", `Bearer ${token}`);
      // inbound (customer) + greeting (system) + auto-sent draft reply (system)
      expect(messages.body.data.messages).toHaveLength(3);
      expect(messages.body.data.messages[2]).toMatchObject({ direction: "outbound", author: "system" });
    });

    it("auto-triages and auto-drafts but leaves an escalated ticket pending for a human", async () => {
      const adapter = new MockModelAdapter({
        "*:triage": {
          content: JSON.stringify({
            category: "warranty",
            priority: "urgent",
            sentiment: "anxious",
            should_escalate: true,
            reason_summary: "Safety hazard reported.",
          }),
        },
        "*:draft": {
          content: JSON.stringify({
            body: "I'm escalating this to a specialist right away.",
            citations: [],
            resolution_type: "escalated",
            recommended_actions: [],
          }),
        },
      });
      const testApp = buildApp(adapter);
      const created = await request(testApp)
        .post("/tickets")
        .set("Authorization", `Bearer ${token}`)
        .send({ customer_id: "cus_1001", channel: "email", subject: "Battery issue", body: "My battery is swelling." });

      expect(created.status).toBe(201);
      expect(created.body.data.pipeline).toEqual({ triage: true, draft: true, auto_sent: false });

      const ticket = await request(testApp)
        .get(`/tickets/${created.body.data.ticket_id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(ticket.body.data.ticket.status).toBe("in_progress");

      const messages = await request(testApp)
        .get(`/tickets/${created.body.data.ticket_id}/messages`)
        .set("Authorization", `Bearer ${token}`);
      // inbound + greeting only — the escalated draft stays pending, unsent.
      expect(messages.body.data.messages).toHaveLength(2);
    });
  });
});
