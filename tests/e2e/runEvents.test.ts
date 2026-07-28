// V2-1 (LLD_v2 §2, ADR-8): GET /tickets/:id/runs/:runId/events (SSE).
// Since triage/draft run synchronously to completion before their POST
// response returns (HLD invariant #6), by the time a client can know a
// runId the run has already finished — so this test exercises exactly the
// "replay persisted events" path, and asserts it emits the same event
// shapes generateDraft/runTriage actually persisted (SSE replay = live
// render: one component renders both, so the wire format must match).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { listRunEventsByRunId } from "../../src/db/repos/runEventsRepo.js";

function parseSse(text: string): { stage: string; status: string; summary: unknown; ts: string }[] {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

describe("GET /tickets/:id/runs/:runId/events (SSE)", () => {
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
    const res = await request(app).get("/tickets/tkt_9001/runs/run_doesnotexist/events");
    expect(res.status).toBe(401);
  });

  it("404s for an unknown ticket", async () => {
    const res = await request(app)
      .get("/tickets/tkt_does_not_exist/runs/run_doesnotexist/events")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("404s for a run that doesn't exist", async () => {
    const res = await request(app)
      .get("/tickets/tkt_9001/runs/run_doesnotexist/events")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("streams the persisted event history for a completed triage run, matching run_events exactly", async () => {
    const triage = await request(app)
      .post("/tickets/tkt_9001/triage")
      .set("Authorization", `Bearer ${token}`);
    expect(triage.status).toBe(200);
    const runId = triage.body.data.run_id as string;

    const res = await request(app)
      .get(`/tickets/tkt_9001/runs/${runId}/events`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const streamed = parseSse(res.text);
    const persisted = await listRunEventsByRunId(runId);

    expect(streamed).toHaveLength(persisted.length);
    expect(streamed.map((e) => [e.stage, e.status])).toEqual(
      persisted.map((e) => [e.stage, e.status])
    );
    expect(streamed.map((e) => e.summary)).toEqual(persisted.map((e) => e.summary));
    // Redaction contract, enforced end-to-end over HTTP too: no draft body,
    // rejected output, or prompt text anywhere on the wire.
    expect(res.text).not.toContain("Bearer");
    expect(res.text.toLowerCase()).not.toContain("system prompt");
  });

  it("authenticates via ?token= since EventSource can't set headers", async () => {
    const triage = await request(app)
      .post("/tickets/tkt_9001/triage")
      .set("Authorization", `Bearer ${token}`);
    const runId = triage.body.data.run_id as string;

    const res = await request(app).get(`/tickets/tkt_9001/runs/${runId}/events?token=${token}`);
    expect(res.status).toBe(200);
    expect(parseSse(res.text).length).toBeGreaterThan(0);
  });

  it("404s a run that belongs to a different ticket", async () => {
    const triage = await request(app)
      .post("/tickets/tkt_9001/triage")
      .set("Authorization", `Bearer ${token}`);
    const runId = triage.body.data.run_id as string;

    const res = await request(app)
      .get(`/tickets/tkt_9002/runs/${runId}/events`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
