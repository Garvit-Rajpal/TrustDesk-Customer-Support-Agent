// V3-4 (LLD_v3 §3, HLD_v3 ADR-15): human takeover — POST
// /tickets/:id/messages/reply bypasses the draft pipeline; the first call
// on a ticket marks it human_owned (one-way), after which draft-reply 409s.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("human takeover (V3-4)", () => {
  let agentToken: string;
  let managerToken: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();

    const agentLogin = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
    agentToken = agentLogin.body.data.token;

    const managerLogin = await request(app)
      .post("/auth/login")
      .send({ username: "manager1", password: "manager123" });
    managerToken = managerLogin.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).post("/tickets/tkt_9002/messages/reply").send({ body: "hi" });
    expect(res.status).toBe(401);
  });

  it("409s from a status that isn't in_progress/awaiting_customer eligible", async () => {
    // tkt_9002 is freshly seeded at status "open" — not yet triaged.
    const res = await request(app)
      .post("/tickets/tkt_9002/messages/reply")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ body: "We're looking into this." });
    expect(res.status).toBe(409);
  });

  it("marks the ticket human_owned on the first manual reply, and blocks draft-reply from then on", async () => {
    await request(app).post("/tickets/tkt_9002/triage").set("Authorization", `Bearer ${agentToken}`);

    const reply = await request(app)
      .post("/tickets/tkt_9002/messages/reply")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ body: "I'll handle this one personally." });
    expect(reply.status).toBe(201);
    expect(reply.body.data).toMatchObject({ direction: "outbound", author: expect.any(String), draft_id: null });

    const ticket = await request(app)
      .get("/tickets/tkt_9002")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(ticket.body.data.ticket.status).toBe("awaiting_customer");
    expect(ticket.body.data.ticket.human_owned).toBe(true);
    expect(ticket.body.data.ticket.human_owned_by).toEqual(expect.any(String));

    const draftAttempt = await request(app)
      .post("/tickets/tkt_9002/draft-reply")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(draftAttempt.status).toBe(409);
  });

  it("a second manual reply on an already-human-owned ticket is idempotent (still human_owned, no error)", async () => {
    // tkt_9002 is awaiting_customer after the prior test — simulate a
    // customer reply (-> customer_replied), then re-triage (still allowed
    // on a human-owned ticket, only draft-reply is blocked) to reach
    // in_progress, the only status a reply can legally be sent from again.
    await request(app)
      .post("/tickets/tkt_9002/messages/simulate-inbound")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ body: "Thanks, still waiting." });
    await request(app).post("/tickets/tkt_9002/triage").set("Authorization", `Bearer ${agentToken}`);

    const second = await request(app)
      .post("/tickets/tkt_9002/messages/reply")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ body: "Following up now." });
    expect(second.status).toBe(201);

    const ticket = await request(app)
      .get("/tickets/tkt_9002")
      .set("Authorization", `Bearer ${agentToken}`);
    expect(ticket.body.data.ticket.human_owned).toBe(true);
  });

  it("tool_actions:request stays available on a human-owned ticket", async () => {
    const res = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        ticket_id: "tkt_9002",
        tool_name: "open_carrier_investigation",
        payload: {
          order_id: "ord_5002",
          tracking_number: "TRACK123",
          reason: "no movement for 6 business days",
          idempotency_key: "human-owned-test-1",
        },
      });
    expect(res.status).toBe(201);
  });
});
