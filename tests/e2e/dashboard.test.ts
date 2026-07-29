// V3-7 (LLD_v3 §5, HLD_v3 ADR-17): dashboard home summary + first-login
// welcome banner set-once semantics.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("dashboard home (V3-7)", () => {
  let adminToken: string;
  let agentToken: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const adminLogin = await request(app).post("/auth/login").send({ username: "admin1", password: "admin123" });
    adminToken = adminLogin.body.data.token;
    const agentLogin = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
    agentToken = agentLogin.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("GET /dashboard/summary", () => {
    it("401s without a token", async () => {
      const res = await request(app).get("/dashboard/summary");
      expect(res.status).toBe(401);
    });

    it("reports tickets_by_status, quality, and eval_summary (not configured yet) for org_default", async () => {
      const res = await request(app).get("/dashboard/summary").set("Authorization", `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets_by_status).toMatchObject({ open: expect.any(Number) });
      expect(Object.values(res.body.data.tickets_by_status as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(8);
      expect(res.body.data.quality).toHaveProperty("draft_acceptance_rate");
      expect(res.body.data.eval_summary).toEqual({ available: false });
    });

    it("eval_summary becomes available once an eval run has completed for org_default", async () => {
      const evalRun = await request(app)
        .post("/eval-runs")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ case_ids: ["eval_004"] });
      expect(evalRun.status).toBe(201);

      const res = await request(app).get("/dashboard/summary").set("Authorization", `Bearer ${agentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.eval_summary).toMatchObject({
        available: true,
        eval_run_id: evalRun.body.data.eval_run_id,
      });
    });

    it("a brand-new org (not org_default) always sees eval_summary.available: false", async () => {
      const createOrg = await request(app)
        .post("/orgs")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Dashboard Test Org",
          vertical: "finance",
          admin_username: "dash_admin",
          admin_password: "dashadminpw",
          admin_display_name: "Dash Admin",
        });
      const login = await request(app).post("/auth/login").send({ username: "dash_admin", password: "dashadminpw" });
      const res = await request(app)
        .get("/dashboard/summary")
        .set("Authorization", `Bearer ${login.body.data.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.eval_summary).toEqual({ available: false });
      expect(createOrg.status).toBe(201); // sanity: org creation itself succeeded
    });
  });

  describe("POST /users/me/welcome-seen", () => {
    it("401s without a token", async () => {
      const res = await request(app).post("/users/me/welcome-seen");
      expect(res.status).toBe(401);
    });

    it("login shows welcome_seen_at: null before it's been dismissed", async () => {
      const login = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
      expect(login.body.data.user.welcome_seen_at).toBeNull();
    });

    it("sets welcome_seen_at once, and it persists across future logins", async () => {
      const seen = await request(app).post("/users/me/welcome-seen").set("Authorization", `Bearer ${agentToken}`);
      expect(seen.status).toBe(200);
      expect(seen.body.data.welcome_seen_at).toEqual(expect.any(String));

      const login = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
      expect(login.body.data.user.welcome_seen_at).toEqual(expect.any(String));
    });
  });
});
