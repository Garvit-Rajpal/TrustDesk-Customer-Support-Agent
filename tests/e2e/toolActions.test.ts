// Milestone 7: HTTP layer over the tool-action lifecycle — request →
// approve/reject → execute.
//
// Full reset before EVERY test: the "one active action per ticket" rule
// (Solution/docs/PROGRESS.md) means a test that approves/executes an
// action on tkt_9001 would otherwise block a later, unrelated test that
// also targets tkt_9001.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("tool-actions lifecycle", () => {
  let token: string;
  // V2-2 (LLD_v2 §3): approve/reject/execute are manager+ only; requesting
  // an action stays agent+.
  let managerToken: string;

  beforeEach(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;

    const managerLogin = await request(app)
      .post("/auth/login")
      .send({ username: "manager1", password: "manager123" });
    managerToken = managerLogin.body.data.token;

    await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${token}`);
    await request(app).post("/tickets/tkt_9002/triage").set("Authorization", `Bearer ${token}`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).post("/tool-actions");
    expect(res.status).toBe(401);
  });

  it("400s on an unknown tool", async () => {
    const res = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({ ticket_id: "tkt_9001", tool_name: "delete_everything", payload: {} });
    expect(res.status).toBe(400);
  });

  it("404s when the ticket doesn't exist", async () => {
    const res = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ticket_id: "tkt_does_not_exist",
        tool_name: "create_replacement_order",
        payload: { order_id: "ord_5001", sku: "x", reason: "y", idempotency_key: "z" },
      });
    expect(res.status).toBe(404);
  });

  it("full happy path: request (approval_required) → approve → execute (create_replacement_order)", async () => {
    const created = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ticket_id: "tkt_9001",
        tool_name: "create_replacement_order",
        payload: {
          order_id: "ord_5001",
          sku: "BG-AIRPODS-01",
          reason: "damaged on arrival",
          idempotency_key: "tkt_9001-replacement-1",
        },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("approval_required");
    const actionId = created.body.data.action_id;

    const approved = await request(app)
      .post(`/tool-actions/${actionId}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ reason: "Confirmed damaged item, within return window." });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("approved");

    const executed = await request(app)
      .post(`/tool-actions/${actionId}/execute`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(executed.status).toBe(200);
    expect(executed.body.data.status).toBe("executed");
    expect(executed.body.data.execution_result).toHaveProperty("replacement_order_id");
  });

  it("auto-approves a low-risk action and allows immediate execution", async () => {
    const created = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ticket_id: "tkt_9002",
        tool_name: "open_carrier_investigation",
        payload: {
          order_id: "ord_5002",
          tracking_number: "BLUETRK10002",
          reason: "stale tracking",
          idempotency_key: "tkt_9002-investigation-1",
        },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("approved");

    const executed = await request(app)
      .post(`/tool-actions/${created.body.data.action_id}/execute`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(executed.status).toBe(200);
    expect(executed.body.data.status).toBe("executed");
  });

  it("409s on illegal transitions (execute before approve, approve after reject)", async () => {
    const created = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        ticket_id: "tkt_9001",
        tool_name: "create_replacement_order",
        payload: {
          order_id: "ord_5001",
          sku: "BG-AIRPODS-01",
          reason: "damaged",
          idempotency_key: "tkt_9001-replacement-illegal",
        },
      });
    const actionId = created.body.data.action_id;

    const executeTooSoon = await request(app)
      .post(`/tool-actions/${actionId}/execute`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(executeTooSoon.status).toBe(409);

    const rejected = await request(app)
      .post(`/tool-actions/${actionId}/reject`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ reason: "not eligible" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("rejected");

    const approveAfterReject = await request(app)
      .post(`/tool-actions/${actionId}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ reason: "changed my mind" });
    expect(approveAfterReject.status).toBe(409);
  });

  it("replays on a repeated idempotency_key (200, not 201, same action_id)", async () => {
    const payload = {
      ticket_id: "tkt_9001",
      tool_name: "create_replacement_order",
      payload: {
        order_id: "ord_5001",
        sku: "BG-AIRPODS-01",
        reason: "damaged",
        idempotency_key: "tkt_9001-replacement-replay-e2e",
      },
    };
    const first = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    const second = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.replayed).toBe(true);
    expect(second.body.data.action_id).toBe(first.body.data.action_id);
  });

  it("404s approve/execute for an unknown action id", async () => {
    const approve = await request(app)
      .post("/tool-actions/act_does_not_exist/approve")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ reason: "x" });
    expect(approve.status).toBe(404);

    const execute = await request(app)
      .post("/tool-actions/act_does_not_exist/execute")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(execute.status).toBe(404);
  });
});
