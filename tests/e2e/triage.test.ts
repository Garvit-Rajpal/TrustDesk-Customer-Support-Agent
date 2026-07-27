// Milestone 5: HTTP layer over the triage flow, using the app's default
// wired MockModelAdapter (src/adapters/defaultMockScenarios.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("POST /tickets/:id/triage", () => {
  let token: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).post("/tickets/tkt_9001/triage");
    expect(res.status).toBe(401);
  });

  it("triages tkt_9001 and returns the full contract shape + run_id", async () => {
    const res = await request(app)
      .post("/tickets/tkt_9001/triage")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      ticket_id: "tkt_9001",
      category: "refund",
      priority: "medium",
      sentiment: "frustrated",
      should_escalate: false,
      reason_summary: expect.any(String),
      run_id: expect.stringMatching(/^run_/),
    });
  });

  it("404s for an unknown ticket", async () => {
    const res = await request(app)
      .post("/tickets/tkt_does_not_exist/triage")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("forces should_escalate=true on tkt_9006 despite the injection asking otherwise", async () => {
    const res = await request(app)
      .post("/tickets/tkt_9006/triage")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.should_escalate).toBe(true);
  });

  it("persists triage onto the ticket, visible via GET /tickets/:id", async () => {
    await request(app).post("/tickets/tkt_9002/triage").set("Authorization", `Bearer ${token}`);

    const fetched = await request(app)
      .get("/tickets/tkt_9002")
      .set("Authorization", `Bearer ${token}`);
    expect(fetched.body.data.ticket.triage.category).toBe("shipping");
  });

  it("GET /agent-runs/:runId returns the trace for the triage run", async () => {
    const triageRes = await request(app)
      .post("/tickets/tkt_9004/triage")
      .set("Authorization", `Bearer ${token}`);
    const runId = triageRes.body.data.run_id;

    const res = await request(app)
      .get(`/agent-runs/${runId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.run_id).toBe(runId);
    expect(res.body.data.run_type).toBe("triage");
    expect(res.body.data.status).toBe("completed");
    expect(res.body.data.guardrail_results.length).toBeGreaterThan(0);
  });

  it("404s for an unknown run id", async () => {
    const res = await request(app)
      .get("/agent-runs/run_does_not_exist")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
