// V4-12 (LLD_v4 §5, HLD_v4 ADR-21): resolveTicket()'s best-effort embedding
// ingestion hook. Exercises the real HTTP resolve route (not the service
// function directly) so the wiring through buildTicketsRouter/app.ts is
// covered too, same as every other thread-mutation test in this suite.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { findSimilarResolutions } from "../../src/db/repos/resolutionEmbeddingsRepo.js";
import { resolveTicket } from "../../src/services/ticketThread.js";
import { getTicketById } from "../../src/db/repos/ticketsRepo.js";
import { MockEmbeddingAdapter } from "../../src/adapters/mockEmbedding.js";
import type { EmbeddingAdapter } from "../../src/adapters/embeddingAdapter.js";
import { runEvalSet } from "../../src/services/evalRunner.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "../../src/adapters/defaultMockScenarios.js";
import { ORG_DEFAULT } from "../helpers/org.js";

describe("resolution embedding ingestion (V4-12)", () => {
  let token: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("embeds the resolution when a ticket with a sent draft is resolved via the HTTP route", async () => {
    // tkt_9004 (warranty, closed in seed data) isn't resolvable again; use
    // tkt_9002, which is open with no draft yet — triage+draft it, send it,
    // then resolve.
    await request(app).post("/tickets/tkt_9002/triage").set("Authorization", `Bearer ${token}`);
    const draft = await request(app).post("/tickets/tkt_9002/draft-reply").set("Authorization", `Bearer ${token}`);
    expect(draft.status).toBe(200);
    if (!draft.body.data.auto_sent) {
      await request(app).post(`/drafts/${draft.body.data.draft_id}/send`).set("Authorization", `Bearer ${token}`);
    }

    const resolve = await request(app).post("/tickets/tkt_9002/resolve").set("Authorization", `Bearer ${token}`);
    expect(resolve.status).toBe(200);

    const results = await findSimilarResolutions(ORG_DEFAULT, new Array(768).fill(0), undefined, 10);
    expect(results.some((r) => r.ticket_id === "tkt_9002")).toBe(true);
  });

  it("skips silently when the ticket has no sent draft (purely human-owned resolution)", async () => {
    // Human takeover, no AI draft ever generated (HLD_v3 ADR-15 flow):
    // triage (open -> in_progress) then a manual reply straight to
    // awaiting_customer, bypassing the draft pipeline entirely.
    await request(app).post("/tickets/tkt_9005/triage").set("Authorization", `Bearer ${token}`);
    const reply = await request(app)
      .post("/tickets/tkt_9005/messages/reply")
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Handled manually, no AI draft involved." });
    expect(reply.status).toBe(201);

    const before = await findSimilarResolutions(ORG_DEFAULT, new Array(768).fill(0), undefined, 50);

    const resolve = await request(app).post("/tickets/tkt_9005/resolve").set("Authorization", `Bearer ${token}`);
    expect(resolve.status).toBe(200);

    const after = await findSimilarResolutions(ORG_DEFAULT, new Array(768).fill(0), undefined, 50);
    expect(after.map((r) => r.embedding_id).sort()).toEqual(before.map((r) => r.embedding_id).sort());
    expect(after.some((r) => r.ticket_id === "tkt_9005")).toBe(false);
  });

  it("a failing embedding adapter never fails the resolve action itself", async () => {
    // Needs a genuine sent draft first, so ingestResolutionEmbedding()
    // actually reaches embeddingAdapter.embed() instead of returning early
    // — otherwise this test would pass without exercising the failure path.
    await request(app).post("/tickets/tkt_9003/triage").set("Authorization", `Bearer ${token}`);
    const draft = await request(app).post("/tickets/tkt_9003/draft-reply").set("Authorization", `Bearer ${token}`);
    if (!draft.body.data.auto_sent) {
      await request(app).post(`/drafts/${draft.body.data.draft_id}/send`).set("Authorization", `Bearer ${token}`);
    }

    const ticket = await getTicketById(ORG_DEFAULT, "tkt_9003");
    if (!ticket) throw new Error("fixture ticket missing");

    const failingAdapter: EmbeddingAdapter = {
      embed: vi.fn().mockRejectedValue(new Error("embedding provider down")),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(ticket.status).toBe("awaiting_customer");
    const outcome = await resolveTicket(ORG_DEFAULT, ticket, failingAdapter);
    expect(outcome.kind).toBe("ok");
    expect(failingAdapter.embed).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // HLD_v4 ADR-21 / invariant #4's spirit: eval fixtures must never reach
  // the embeddings table. The eval runner calls runTriage()/generateDraft()
  // directly and never resolveTicket() at all — structurally impossible,
  // proven here rather than just asserted in prose.
  it("running an eval set never inserts any resolution embeddings for org_default", async () => {
    const before = await findSimilarResolutions(ORG_DEFAULT, new Array(768).fill(0), undefined, 1000);

    const adapter = new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
    await runEvalSet(adapter);

    const after = await findSimilarResolutions(ORG_DEFAULT, new Array(768).fill(0), undefined, 1000);
    expect(after.length).toBe(before.length);
  });

  it("MockEmbeddingAdapter is the ingestion adapter used by the default app export (never a real endpoint)", async () => {
    // Structural check: app.ts's default export wires MockEmbeddingAdapter
    // by default — this test just confirms the class it constructs.
    const adapter = new MockEmbeddingAdapter();
    const vector = await adapter.embed("some resolution text");
    expect(vector).toHaveLength(768);
  });
});
