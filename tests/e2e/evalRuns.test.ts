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
    const login = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
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
});
