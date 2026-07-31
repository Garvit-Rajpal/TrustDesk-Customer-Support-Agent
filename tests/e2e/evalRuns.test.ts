// Milestone 8: HTTP layer over the eval runner.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("eval-runs API", () => {
  let token: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    // V2-2 (LLD_v2 §3): running an eval set is admin-only; admin can also
    // do everything an agent can (fetch by id), so one token suffices here.
    const login = await request(app)
      .post("/auth/login")
      .send({ username: "admin1", password: "admin123" });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).post("/eval-runs");
    expect(res.status).toBe(401);
  });

  it("runs all cases by default and reports the 4 required metrics", async () => {
    const res = await request(app).post("/eval-runs").set("Authorization", `Bearer ${token}`).send({});

    expect(res.status).toBe(201);
    expect(res.body.data.total_cases).toBe(8);
    expect(res.body.data.metrics).toEqual({
      triage_accuracy: 1,
      citation_coverage: 0.75,
      unsafe_action_block_rate: 1,
      escalation_accuracy: 1,
    });
    expect(res.body.data.case_results).toHaveLength(8);
  });

  it("runs a selected subset via case_ids", async () => {
    const res = await request(app)
      .post("/eval-runs")
      .set("Authorization", `Bearer ${token}`)
      .send({ case_ids: ["eval_004"] });

    expect(res.status).toBe(201);
    expect(res.body.data.total_cases).toBe(1);
    expect(res.body.data.case_results[0].case_id).toBe("eval_004");
  });

  it("fetches a stored eval run by id", async () => {
    const created = await request(app)
      .post("/eval-runs")
      .set("Authorization", `Bearer ${token}`)
      .send({});
    const runId = created.body.data.eval_run_id;

    const res = await request(app)
      .get(`/eval-runs/${runId}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.eval_run_id).toBe(runId);
    expect(res.body.data.total_cases).toBe(8);
  });

  it("404s for an unknown eval run id", async () => {
    const res = await request(app)
      .get("/eval-runs/eval_run_does_not_exist")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // V4-6 (LLD_v4 §4, HLD_v4 ADR-20): mints an ID synchronously, before the
  // run itself starts, so a client can open the SSE stream first.
  describe("POST /eval-runs/start", () => {
    it("401s without a token", async () => {
      const res = await request(app).post("/eval-runs/start");
      expect(res.status).toBe(401);
    });

    it("mints an eval_run_id and persists a pending row (completed_at null, no metrics yet)", async () => {
      const res = await request(app).post("/eval-runs/start").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(201);
      expect(res.body.data.eval_run_id).toMatch(/^eval_run_/);

      // V4-6: a pending row, not "not found" — this is what closes the
      // GET /eval-runs/:runId/events race (see evalRunEvents.test.ts).
      const fetched = await request(app)
        .get(`/eval-runs/${res.body.data.eval_run_id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.data.completed_at).toBeNull();
      expect(fetched.body.data.metrics).toBeNull();
    });

    it("a minted eval_run_id can be reused by POST /eval-runs to run under that same id", async () => {
      const started = await request(app).post("/eval-runs/start").set("Authorization", `Bearer ${token}`);
      const evalRunId = started.body.data.eval_run_id;

      const res = await request(app)
        .post("/eval-runs")
        .set("Authorization", `Bearer ${token}`)
        .send({ eval_run_id: evalRunId, case_ids: ["eval_001"] });

      expect(res.status).toBe(201);
      expect(res.body.data.eval_run_id).toBe(evalRunId);

      const fetched = await request(app)
        .get(`/eval-runs/${evalRunId}`)
        .set("Authorization", `Bearer ${token}`);
      expect(fetched.status).toBe(200);
    });
  });
});
