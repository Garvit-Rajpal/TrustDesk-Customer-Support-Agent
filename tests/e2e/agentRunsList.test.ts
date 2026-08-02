// Audit trail (AuditTrail.tsx): GET /agent-runs lists every agent_runs row
// for the caller's own org, most recent first, joined out to its ticket's
// customer + order. Same runs:view permission tier as GET /agent-runs/:runId
// (tests/e2e/triage.test.ts, tests/e2e/rbac.test.ts's permission matrix) —
// this file only covers what's new: the join shape and org isolation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("GET /agent-runs (list)", () => {
  let token: string;
  let adminToken: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;
    const adminLogin = await request(app).post("/auth/login").send({ username: "admin1", password: "admin123" });
    adminToken = adminLogin.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/agent-runs");
    expect(res.status).toBe(401);
  });

  it("returns the run just created, joined to its ticket's customer and order", async () => {
    const triage = await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${token}`);
    const runId = triage.body.data.run_id;

    const res = await request(app).get("/agent-runs").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const row = res.body.data.runs.find((r: { run_id: string }) => r.run_id === runId);
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      run_type: "triage",
      status: "completed",
      ticket_id: "tkt_9001",
      ticket_subject: expect.any(String),
      customer_id: "cus_1001",
      customer_name: "Aisha Rao",
      customer_email: "aisha.rao@example.com",
      order_id: "ord_5001",
    });
    // Listing intentionally omits the heavier per-run fields (tool_calls,
    // rejected_output, retrieved_doc_ids) — GET /agent-runs/:runId already
    // covers those.
    expect(row.tool_calls).toBeUndefined();
    expect(row.rejected_output).toBeUndefined();
    expect(row.guardrail_results.length).toBeGreaterThan(0);
  });

  it("still returns a row for a ticket with no linked order (order_id null)", async () => {
    // Every seeded ticket (data/tickets.json) has an order_id — create a
    // fresh one without one to exercise the LEFT JOIN's null case.
    // POST /tickets auto-triggers the intake pipeline (V3-5), which writes
    // an agent_runs row synchronously regardless of whether the freshly
    // nanoid-generated ticket_id happens to have a matching mock scenario.
    const created = await request(app)
      .post("/tickets")
      .set("Authorization", `Bearer ${token}`)
      .send({ customer_id: "cus_1001", channel: "email", subject: "No order", body: "General question." });
    const ticketId = created.body.data.ticket_id;

    const res = await request(app).get("/agent-runs").set("Authorization", `Bearer ${token}`);
    const row = res.body.data.runs.find((r: { ticket_id: string }) => r.ticket_id === ticketId);
    expect(row).toBeDefined();
    expect(row.order_id).toBeNull();
  });

  it("most recent run appears first", async () => {
    const first = await request(app).post("/tickets/tkt_9003/triage").set("Authorization", `Bearer ${token}`);
    const second = await request(app).post("/tickets/tkt_9004/triage").set("Authorization", `Bearer ${token}`);

    const res = await request(app).get("/agent-runs").set("Authorization", `Bearer ${token}`);
    const ids = res.body.data.runs.map((r: { run_id: string }) => r.run_id);
    expect(ids.indexOf(second.body.data.run_id)).toBeLessThan(ids.indexOf(first.body.data.run_id));
  });

  it("a second org's runs never appear in org_default's list, and vice versa", async () => {
    const createOrg = await request(app)
      .post("/orgs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Acme Software",
        vertical: "software",
        admin_username: "acme_admin_runs",
        admin_password: "acmeadminpw",
        admin_display_name: "Acme Admin",
      });
    expect(createOrg.status).toBe(201);

    const acmeLogin = await request(app)
      .post("/auth/login")
      .send({ username: "acme_admin_runs", password: "acmeadminpw" });
    const acmeToken = acmeLogin.body.data.token;

    // org_default's agent can't see into the new org — none of Acme's
    // freshly-seeded customer_ids (returned by POST /orgs) ever appear in
    // org_default's own run listing.
    const defaultOrgRuns = await request(app).get("/agent-runs").set("Authorization", `Bearer ${token}`);
    const seenCustomerIds = defaultOrgRuns.body.data.runs.map((r: { customer_id: string | null }) => r.customer_id);
    for (const acmeCustomerId of createOrg.body.data.customer_ids) {
      expect(seenCustomerIds).not.toContain(acmeCustomerId);
    }

    // ...and the new org (freshly onboarded, no tickets/runs of its own yet)
    // sees an empty list, not org_default's seeded runs.
    const acmeRuns = await request(app).get("/agent-runs").set("Authorization", `Bearer ${acmeToken}`);
    expect(acmeRuns.status).toBe(200);
    expect(acmeRuns.body.data.runs).toEqual([]);
  });
});
