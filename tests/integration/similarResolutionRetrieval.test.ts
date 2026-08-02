// V4-13 (LLD_v4 §5, HLD_v4 ADR-21): similar-resolution context reaches the
// prompt passed to the model adapter — end-to-end through generateDraft(),
// not just the prompt-builder unit test (draftV1.test.ts) or the repo-level
// nearest-neighbor test (resolutionEmbeddingsRepo.test.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { buildApp } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "../../src/adapters/defaultMockScenarios.js";
import { MockEmbeddingAdapter } from "../../src/adapters/mockEmbedding.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "../../src/adapters/modelAdapter.js";

describe("similar-resolution retrieval reaches the draft prompt (V4-13)", () => {
  let token: string;
  let completeSpy: ReturnType<typeof vi.fn<(request: ModelRequest) => Promise<ModelResponse>>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();

    const realAdapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    completeSpy = vi.fn((request: ModelRequest) => realAdapter.complete(request));
    const modelAdapter: ModelAdapter = { complete: completeSpy };
    app = buildApp(modelAdapter, new MockEmbeddingAdapter());

    const login = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("wires a prior resolution's source_text into a later ticket's draft prompt", async () => {
    // Resolve tkt_9001 first — its sent draft becomes the only row in
    // ticket_resolution_embeddings, so any later query trivially finds it.
    await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${token}`);
    const firstDraft = await request(app)
      .post("/tickets/tkt_9001/draft-reply")
      .set("Authorization", `Bearer ${token}`);
    expect(firstDraft.status).toBe(200);
    if (!firstDraft.body.data.auto_sent) {
      await request(app)
        .post(`/drafts/${firstDraft.body.data.draft_id}/send`)
        .set("Authorization", `Bearer ${token}`);
    }
    const resolve = await request(app).post("/tickets/tkt_9001/resolve").set("Authorization", `Bearer ${token}`);
    expect(resolve.status).toBe(200);

    completeSpy.mockClear();

    // Now draft tkt_9003 — same triage category ("refund") as tkt_9001, so
    // generateDraft()'s category-scoped similarity search actually matches
    // it and folds tkt_9001's sent draft body into tkt_9003's prompt.
    await request(app).post("/tickets/tkt_9003/triage").set("Authorization", `Bearer ${token}`);
    const secondDraft = await request(app)
      .post("/tickets/tkt_9003/draft-reply")
      .set("Authorization", `Bearer ${token}`);
    expect(secondDraft.status).toBe(200);

    const draftCall = completeSpy.mock.calls.find(
      (call) => (call[0] as { scenario: string }).scenario === "tkt_9003:draft"
    );
    expect(draftCall).toBeDefined();
    const userPrompt = (draftCall![0] as { userPrompt: string }).userPrompt;
    expect(userPrompt).toContain("SIMILAR PAST RESOLUTIONS");
    expect(userPrompt).toContain(firstDraft.body.data.body);

    // RAG-pipeline visibility (migration 1786100000000): the same match
    // that reached the prompt above is also persisted on this draft's own
    // agent_runs row, not just used in-memory and discarded — this is what
    // TracePanel/the audit trail read to show it in the frontend.
    const trace = await request(app)
      .get(`/agent-runs/${secondDraft.body.data.run_id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(trace.body.data.similar_resolutions).toHaveLength(1);
    expect(trace.body.data.similar_resolutions[0]).toMatchObject({
      ticket_id: "tkt_9001",
      source_text: firstDraft.body.data.body,
    });
    expect(typeof trace.body.data.similar_resolutions[0].distance).toBe("number");
  });
});
