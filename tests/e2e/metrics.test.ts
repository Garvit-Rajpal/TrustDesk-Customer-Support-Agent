// V2-3 (LLD_v2 §4/§9): GET /metrics/agent-quality — manager+, and reflects
// real feedback/approvals/agent_runs written through the actual API (not
// fixture rows inserted directly), proving the repo joins + pure scorer
// wire together correctly end to end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("GET /metrics/agent-quality", () => {
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

    // tkt_9001 -> refund category (default mock scenario).
    await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${agentToken}`);
    const draft = await request(app)
      .post("/tickets/tkt_9001/draft-reply")
      .set("Authorization", `Bearer ${agentToken}`);
    const draftId = draft.body.data.draft_id;

    await request(app)
      .post(`/drafts/${draftId}/feedback`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ rating: 5 });

    const toolName = draft.body.data.recommended_actions[0].tool_name;
    const created = await request(app)
      .post("/tool-actions")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({
        ticket_id: "tkt_9001",
        tool_name: toolName,
        payload: {
          order_id: "ord_5001",
          sku: "BG-AIRPODS-01",
          reason: "damaged",
          idempotency_key: "tkt_9001-metrics-fixture",
        },
      });
    await request(app)
      .post(`/tool-actions/${created.body.data.action_id}/approve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ reason: "confirmed" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/metrics/agent-quality");
    expect(res.status).toBe(401);
  });

  it("403s for an agent — manager+ only", async () => {
    const res = await request(app).get("/metrics/agent-quality").set("Authorization", `Bearer ${agentToken}`);
    expect(res.status).toBe(403);
  });

  it("200s for a manager with the 4 required metrics + a refund breakdown", async () => {
    const res = await request(app)
      .get("/metrics/agent-quality")
      .set("Authorization", `Bearer ${managerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      draft_acceptance_rate: 1, // one rating=5, >=4 threshold
      action_approval_rate: 1, // one approval, approved
      avg_rating: 5,
      guardrail_block_rate: 0, // one draft_reply run, completed not blocked
    });
    expect(res.body.data.by_category.refund).toEqual({
      draft_acceptance_rate: 1,
      action_approval_rate: 1,
      avg_rating: 5,
      guardrail_block_rate: 0,
    });
  });
});
