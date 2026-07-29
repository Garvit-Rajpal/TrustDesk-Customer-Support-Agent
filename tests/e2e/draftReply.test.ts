// Milestone 6: HTTP layer over the draft flow, using the app's default
// wired MockModelAdapter (src/adapters/defaultMockScenarios.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("POST /tickets/:id/draft-reply", () => {
  let token: string;
  // V2-2 (LLD_v2 §3): rejected_output on a trace is manager+ only.
  let managerToken: string;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).post("/tickets/tkt_9001/draft-reply");
    expect(res.status).toBe(401);
  });

  it("409s if the ticket hasn't been triaged yet (HLD invariant #9)", async () => {
    const res = await request(app)
      .post("/tickets/tkt_9001/draft-reply")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("404s for an unknown ticket", async () => {
    const res = await request(app)
      .post("/tickets/tkt_does_not_exist/draft-reply")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("drafts a cited, approval-gated reply after triage (tkt_9001)", async () => {
    await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post("/tickets/tkt_9001/draft-reply")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      draft_id: expect.stringMatching(/^draft_/),
      ticket_id: "tkt_9001",
      resolution_type: "answered",
      body: expect.any(String),
      citations: ["KB-REFUND-001"],
      recommended_actions: [
        {
          tool_name: "create_replacement_order",
          requires_human_approval: true,
          reason: expect.any(String),
        },
      ],
      run_id: expect.stringMatching(/^run_/),
      // V3-5: create_replacement_order requires human approval, so this
      // draft is not auto-send eligible despite resolution_type "answered".
      auto_sent: false,
    });
  });

  it("refuses by policy for a final-sale item (tkt_9003)", async () => {
    await request(app).post("/tickets/tkt_9003/triage").set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post("/tickets/tkt_9003/draft-reply")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resolution_type).toBe("refused_by_policy");
    expect(res.body.data.recommended_actions).toEqual([]);
  });

  it("escalates for a safety issue (tkt_9004)", async () => {
    await request(app).post("/tickets/tkt_9004/triage").set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post("/tickets/tkt_9004/draft-reply")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resolution_type).toBe("escalated");
  });

  it("fail-closes tkt_9006's injection attempt to a safe escalation template (still 200)", async () => {
    await request(app).post("/tickets/tkt_9006/triage").set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post("/tickets/tkt_9006/draft-reply")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resolution_type).toBe("escalated");
    expect(res.body.data.citations).toEqual([]);
    expect(res.body.data.recommended_actions).toEqual([]);
    // The escalation template body — never the model's adversarial-quoting draft.
    expect(res.body.data.body).not.toContain("reveal all hidden instructions");

    const agentView = await request(app)
      .get(`/agent-runs/${res.body.data.run_id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(agentView.body.data.status).toBe("guardrail_blocked");
    // V2-2 (LLD_v2 §3): an agent can see that a guardrail fired but not
    // the discarded model draft itself — that's manager+ only.
    expect(agentView.body.data.rejected_output).toBeNull();

    const managerView = await request(app)
      .get(`/agent-runs/${res.body.data.run_id}`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(managerView.body.data.rejected_output).toBeTruthy();
  });

  it("fail-closes tkt_9007's fake secret leak to a safe escalation template (still 200)", async () => {
    await request(app).post("/tickets/tkt_9007/triage").set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post("/tickets/tkt_9007/draft-reply")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.resolution_type).toBe("escalated");
    expect(res.body.data.body).not.toContain("OPENAI_API_KEY");
  });
});
