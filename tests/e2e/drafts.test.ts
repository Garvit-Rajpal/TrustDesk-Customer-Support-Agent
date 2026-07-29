// V2-3 (LLD_v2 §4/§9): POST /drafts/:id/feedback — upsert-per-reviewer,
// 401/403/404/400 envelopes, unique-per-reviewer-per-draft behavior.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("POST /drafts/:id/feedback", () => {
  let agentToken: string;
  let managerToken: string;
  let draftId: string;

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

    await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${agentToken}`);
    const draft = await request(app)
      .post("/tickets/tkt_9001/draft-reply")
      .set("Authorization", `Bearer ${agentToken}`);
    draftId = draft.body.data.draft_id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).post(`/drafts/${draftId}/feedback`);
    expect(res.status).toBe(401);
  });

  it("400s on an out-of-range rating", async () => {
    const res = await request(app)
      .post(`/drafts/${draftId}/feedback`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ rating: 6 });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown draft", async () => {
    const res = await request(app)
      .post("/drafts/draft_does_not_exist/feedback")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ rating: 5 });
    expect(res.status).toBe(404);
  });

  it("201s on first submission, 200s when the same reviewer resubmits (upsert)", async () => {
    const first = await request(app)
      .post(`/drafts/${draftId}/feedback`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ rating: 3, reason: "Missed a detail" });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      draft_id: draftId,
      rating: 3,
      reason: "Missed a detail",
    });
    const feedbackId = first.body.data.feedback_id;

    const second = await request(app)
      .post(`/drafts/${draftId}/feedback`)
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ rating: 5, corrected_response: "Actually this was fine." });
    expect(second.status).toBe(200);
    expect(second.body.data.feedback_id).toBe(feedbackId); // same row, updated
    expect(second.body.data.rating).toBe(5);
    expect(second.body.data.reason).toBeNull(); // not resent, overwritten to null
    expect(second.body.data.corrected_response).toBe("Actually this was fine.");
  });

  it("lets a different reviewer submit their own feedback on the same draft", async () => {
    const managerFeedback = await request(app)
      .post(`/drafts/${draftId}/feedback`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ rating: 2 });
    expect(managerFeedback.status).toBe(201); // new row — different reviewer_id
  });
});
