// V4-7 (LLD_v4 §4, HLD_v4 ADR-20): GET /eval-runs/:runId/events (SSE) —
// near-verbatim mirror of GET /tickets/:id/runs/:runId/events (runEvents
// test), minus the ticket-ownership lookup an eval run has no ticket_id
// for. Covers both the replay path (run already finished — the eval
// runner runs synchronously start-to-finish, LLD_v4 §4) and the live
// path (subscribe before the run starts, via POST /eval-runs/start).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { runEvalSet } from "../../src/services/evalRunner.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "../../src/adapters/defaultMockScenarios.js";
import { listRunEventsByRunId } from "../../src/db/repos/runEventsRepo.js";

function parseSse(text: string): { stage: string; status: string; summary: unknown; ts: string }[] {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}

describe("GET /eval-runs/:runId/events (SSE)", () => {
  let token: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app)
      .post("/auth/login")
      .send({ username: "admin1", password: "admin123" });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/eval-runs/eval_run_doesnotexist/events");
    expect(res.status).toBe(401);
  });

  it("404s for an eval run id with no events at all", async () => {
    const res = await request(app)
      .get("/eval-runs/eval_run_doesnotexist/events")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("replays the persisted eval_case event history for a completed run, matching run_events exactly", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const report = await runEvalSet(adapter, ["eval_001", "eval_003"]);

    const res = await request(app)
      .get(`/eval-runs/${report.eval_run_id}/events`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);

    const streamed = parseSse(res.text);
    const persisted = await listRunEventsByRunId(report.eval_run_id);

    expect(streamed).toHaveLength(persisted.length);
    expect(streamed.map((e) => [e.stage, e.status])).toEqual(persisted.map((e) => [e.stage, e.status]));
    expect(streamed.map((e) => e.summary)).toEqual(persisted.map((e) => e.summary));
    expect(streamed[streamed.length - 1]!.summary).toMatchObject({ case_id: "eval_003" });
  });

  it("streams live events for a run started via POST /eval-runs/start, even subscribed before the first case event exists", async () => {
    const started = await request(app).post("/eval-runs/start").set("Authorization", `Bearer ${token}`);
    const evalRunId = started.body.data.eval_run_id;

    // No delay, deliberately: POST /eval-runs/start's pending eval_runs row
    // (V4-6) is what lets the SSE route tell "minted but not started yet"
    // apart from "unknown id" — without it, a subscribe this early would
    // 404 (see LLD_v4 §4). Kick the run off without awaiting so the SSE
    // request below genuinely races it.
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const runPromise = runEvalSet(adapter, ["eval_001", "eval_002"], evalRunId);

    const res = await request(app)
      .get(`/eval-runs/${evalRunId}/events`)
      .set("Authorization", `Bearer ${token}`);

    await runPromise;

    expect(res.status).toBe(200);
    const streamed = parseSse(res.text);
    expect(streamed.length).toBeGreaterThan(0);
    expect(streamed.every((e) => e.stage === "eval_case")).toBe(true);
    expect(streamed[streamed.length - 1]).toMatchObject({ stage: "eval_case", status: "completed" });
  });

  it("authenticates via ?token= since EventSource can't set headers", async () => {
    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    const report = await runEvalSet(adapter, ["eval_001"]);

    const res = await request(app).get(`/eval-runs/${report.eval_run_id}/events?token=${token}`);
    expect(res.status).toBe(200);
    expect(parseSse(res.text).length).toBeGreaterThan(0);
  });
});
