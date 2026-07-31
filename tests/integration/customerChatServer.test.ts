// W17 (LLD_v4 §7, V4-22): customerChatServer.ts's connect/reject/reconnect
// behavior. Needs a *real* http.Server + listening socket — WS upgrades
// can't be driven through supertest the way the rest of the app is tested,
// which is exactly why this attaches to its own throwaway server rather
// than the shared `app` export (server.ts, not app.ts, is the only real
// caller of attachCustomerChatServer — see that file's header comment).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import request from "supertest";
import { app } from "../../src/app.js";
import { attachCustomerChatServer } from "../../src/ws/customerChatServer.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { MockEmbeddingAdapter } from "../../src/adapters/mockEmbedding.js";
import { DEFAULT_MODEL_SCENARIOS } from "../../src/adapters/defaultMockScenarios.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { signCustomerToken, signToken } from "../../src/services/tokens.js";

describe("customerChatServer (W17/V4-22)", () => {
  let baseUrl: string;
  let httpServer: http.Server;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    httpServer = http.createServer(app);
    attachCustomerChatServer(httpServer, new MockModelAdapter(DEFAULT_MODEL_SCENARIOS), new MockEmbeddingAdapter());
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (typeof address === "string" || address === null) throw new Error("expected a port");
    baseUrl = `ws://127.0.0.1:${address.port}/customer-chat`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await pool.end();
  });

  function waitForClose(ws: WebSocket): Promise<number> {
    return new Promise((resolve) => ws.on("close", (code) => resolve(code)));
  }

  function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("error", reject);
    });
  }

  it("closes with 4001 when no token is supplied", async () => {
    const ws = new WebSocket(baseUrl);
    const code = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("closes with 4001 on a garbage token", async () => {
    const ws = new WebSocket(`${baseUrl}?token=not-a-real-token`);
    const code = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("closes with 4001 on an agent JWT presented as a customer token", async () => {
    const agentToken = signToken({ sub: "usr_1", name: "Agent", role: "agent", org_id: "org_default" });
    const ws = new WebSocket(`${baseUrl}?token=${agentToken}`);
    const code = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("closes with 4001 on an expired customer token", async () => {
    const jwt = await import("jsonwebtoken");
    const expired = jwt.default.sign(
      { customer_id: "cus_1001", org_id: "org_default", kind: "customer" },
      process.env.JWT_SECRET as string,
      { algorithm: "HS256", expiresIn: -1 }
    );
    const ws = new WebSocket(`${baseUrl}?token=${expired}`);
    const code = await waitForClose(ws);
    expect(code).toBe(4001);
  });

  it("accepts a valid customer token with no ticket_id (no reconnect replay)", async () => {
    const token = signCustomerToken({ customer_id: "cus_1001", org_id: "org_default", kind: "customer" });
    const ws = new WebSocket(`${baseUrl}?token=${token}`);
    await waitForOpen(ws);
    ws.close();
  });

  it("ticket-scoped reconnect replays the ticket's persisted messages", async () => {
    // Seed loader gives every ticket exactly one persisted inbound message
    // (msg_seed_<ticket_id>, body === ticket.body) — tkt_9001 belongs to
    // cus_1001 (see data/tickets.json / data/customers.json fixtures).
    const token = signCustomerToken({
      customer_id: "cus_1001",
      org_id: "org_default",
      ticket_id: "tkt_9001",
      kind: "customer",
    });
    const ws = new WebSocket(`${baseUrl}?token=${token}`);
    const received: any[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await waitForOpen(ws);
    // Give the async reconnect-replay handler a beat to run and flush its
    // sends before asserting.
    await new Promise((resolve) => setTimeout(resolve, 200));
    ws.close();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "message", direction: "inbound", author: "customer" });
    expect(received[0].body).toContain("BlueBuds Air");
  });

  it("a ticket-scoped token for a nonexistent ticket connects with an empty replay (no crash)", async () => {
    const token = signCustomerToken({
      customer_id: "cus_1001",
      org_id: "org_default",
      ticket_id: "tkt_does_not_exist",
      kind: "customer",
    });
    const ws = new WebSocket(`${baseUrl}?token=${token}`);
    const received: any[] = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    await waitForOpen(ws);
    await new Promise((resolve) => setTimeout(resolve, 100));
    ws.close();
    expect(received).toHaveLength(0);
  });

  it("an inbound chat message on a ticket-scoped connection appends to the thread (verified customer_id, not the literal 'customer')", async () => {
    const token = signCustomerToken({
      customer_id: "cus_1004",
      org_id: "org_default",
      ticket_id: "tkt_9003",
      kind: "customer",
    });
    // tkt_9003 (cus_1004) needs to be moved out of "open" first — the
    // customer_replied transition this triggers is only legal from
    // awaiting_customer/resolved, same rule receiveCustomerMessage() shares
    // with simulateInbound().
    const loginRes = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
    const agentToken = loginRes.body.data.token;
    await request(app).post("/tickets/tkt_9003/triage").set("Authorization", `Bearer ${agentToken}`);
    const draft = await request(app)
      .post("/tickets/tkt_9003/draft-reply")
      .set("Authorization", `Bearer ${agentToken}`);
    if (!draft.body.data.auto_sent) {
      await request(app)
        .post(`/drafts/${draft.body.data.draft_id}/send`)
        .set("Authorization", `Bearer ${agentToken}`);
    }

    const ws = new WebSocket(`${baseUrl}?token=${token}`);
    await waitForOpen(ws);
    await new Promise((resolve) => setTimeout(resolve, 100)); // let replay flush
    ws.send(JSON.stringify({ body: "Any update on this?" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    ws.close();

    const thread = await request(app)
      .get("/tickets/tkt_9003/messages")
      .set("Authorization", `Bearer ${agentToken}`);
    const last = thread.body.data.messages[thread.body.data.messages.length - 1];
    expect(last.body).toBe("Any update on this?");
    expect(last.author).toBe("cus_1004");
  });

  // V4-23 (LLD_v4 §7): auto-send-vs-pending bridging. Nested in the same
  // outer describe (sharing its beforeAll/afterAll — in particular the
  // single pool.end() at the very end of this file) since each scenario
  // below needs its own per-test httpServer + differently-scripted
  // MockModelAdapter (mirrors autoSend.test.ts's "*:triage"/"*:draft"
  // wildcard pattern for freshly-created, WS-triggered tickets).
  describe("auto-send-vs-pending bridging (W17/V4-23)", () => {
    async function withChatServer(
      adapter: MockModelAdapter,
      fn: (baseUrl: string) => Promise<void>
    ): Promise<void> {
      const server = http.createServer(app);
      attachCustomerChatServer(server, adapter, new MockEmbeddingAdapter());
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const address = server.address();
      if (typeof address === "string" || address === null) throw new Error("expected a port");
      try {
        await fn(`ws://127.0.0.1:${address.port}/customer-chat`);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    function waitForOpen(ws: WebSocket): Promise<void> {
      return new Promise((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
      });
    }

    it("pushes an eligible auto-sent reply to the WS client verbatim, no status frame", async () => {
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
        "*:judge": { content: JSON.stringify({ passed: true, reason: "fine" }) },
      });

      await withChatServer(adapter, async (baseUrl) => {
        const token = signCustomerToken({ customer_id: "cus_1001", org_id: "org_default", kind: "customer" });
        const ws = new WebSocket(`${baseUrl}?token=${token}`);
        const received: any[] = [];
        ws.on("message", (data) => received.push(JSON.parse(data.toString())));
        await waitForOpen(ws);
        ws.send(JSON.stringify({ body: "How do I track my order?" }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        ws.close();

        const messageFrames = received.filter((f) => f.type === "message");
        expect(messageFrames).toHaveLength(1);
        expect(messageFrames[0]).toMatchObject({
          direction: "outbound",
          body: "Thanks for reaching out — here's the answer to your question.",
        });
        expect(received.some((f) => f.type === "status")).toBe(false);
      });
    });

    it("never sends a pending/escalated draft body — only the generic status frame", async () => {
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
            body: "SECRET_DRAFT_BODY_SHOULD_NOT_LEAK — escalating this to a specialist right away.",
            citations: [],
            resolution_type: "escalated",
            recommended_actions: [],
          }),
        },
        "*:judge": { content: JSON.stringify({ passed: true, reason: "fine" }) },
      });

      await withChatServer(adapter, async (baseUrl) => {
        const token = signCustomerToken({ customer_id: "cus_1001", org_id: "org_default", kind: "customer" });
        const ws = new WebSocket(`${baseUrl}?token=${token}`);
        const received: any[] = [];
        ws.on("message", (data) => received.push(JSON.parse(data.toString())));
        await waitForOpen(ws);
        ws.send(JSON.stringify({ body: "My battery is swelling." }));
        await new Promise((resolve) => setTimeout(resolve, 500));
        ws.close();

        expect(received.some((f) => f.type === "message")).toBe(false);
        expect(received).toContainEqual({ type: "status", text: "a support specialist will respond shortly" });
        expect(JSON.stringify(received)).not.toContain("SECRET_DRAFT_BODY_SHOULD_NOT_LEAK");
      });
    });

    it("delivers a later, out-of-band human agent reply to an already-open ticket-scoped connection", async () => {
      // tkt_9006 / cus_1006 (data/tickets.json, data/customers.json) — not
      // used by any earlier test in this file, so its status is still
      // whatever the fresh seed left it in ("open").
      const adapter = new MockModelAdapter({});
      await withChatServer(adapter, async (baseUrl) => {
        const loginRes = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
        const agentToken = loginRes.body.data.token;
        // Move tkt_9006 to a manual-reply-eligible status without going
        // through draft/auto-send at all (LLD_v3 §3's human-takeover path).
        await request(app).post("/tickets/tkt_9006/triage").set("Authorization", `Bearer ${agentToken}`);

        const token = signCustomerToken({
          customer_id: "cus_1006",
          org_id: "org_default",
          ticket_id: "tkt_9006",
          kind: "customer",
        });
        const ws = new WebSocket(`${baseUrl}?token=${token}`);
        const received: any[] = [];
        ws.on("message", (data) => received.push(JSON.parse(data.toString())));
        await waitForOpen(ws);
        await new Promise((resolve) => setTimeout(resolve, 150)); // let reconnect replay + subscribe land

        await request(app)
          .post("/tickets/tkt_9006/messages/reply")
          .set("Authorization", `Bearer ${agentToken}`)
          .send({ body: "A human agent here — following up personally." });

        await new Promise((resolve) => setTimeout(resolve, 300));
        ws.close();

        const messageFrames = received.filter((f) => f.type === "message");
        const humanReply = messageFrames.find((f) => f.body === "A human agent here — following up personally.");
        expect(humanReply).toBeDefined();
        expect(humanReply.direction).toBe("outbound");
      });
    });
  });
});

