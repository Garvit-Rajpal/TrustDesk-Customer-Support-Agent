// RAG-pipeline visibility: GET /embeddings lists the resolution-embedding
// index (ticket_resolution_embeddings), org_default only — same tenancy
// shape as /platform (tests/e2e/platformSupport.test.ts's "403s for a
// caller that isn't org_default" pattern, mirrored here).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("GET /embeddings (org_default only)", () => {
  let defaultToken: string;
  let defaultAdminToken: string;
  let softwareAdminToken: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();

    const login = await request(app).post("/auth/login").send({ username: "agent1", password: "agent123" });
    defaultToken = login.body.data.token;
    const adminLogin = await request(app).post("/auth/login").send({ username: "admin1", password: "admin123" });
    defaultAdminToken = adminLogin.body.data.token;

    const createOrg = await request(app)
      .post("/orgs")
      .set("Authorization", `Bearer ${defaultAdminToken}`)
      .send({
        name: "Acme Software",
        vertical: "software",
        admin_username: "acme_admin_emb",
        admin_password: "acmeadminpw",
        admin_display_name: "Acme Admin",
      });
    expect(createOrg.status).toBe(201);
    const softwareLogin = await request(app)
      .post("/auth/login")
      .send({ username: "acme_admin_emb", password: "acmeadminpw" });
    softwareAdminToken = softwareLogin.body.data.token;

    // Resolve tkt_9001 (sent draft) so org_default actually has a row to list.
    await request(app).post("/tickets/tkt_9001/triage").set("Authorization", `Bearer ${defaultToken}`);
    const draft = await request(app)
      .post("/tickets/tkt_9001/draft-reply")
      .set("Authorization", `Bearer ${defaultToken}`);
    if (!draft.body.data.auto_sent) {
      await request(app)
        .post(`/drafts/${draft.body.data.draft_id}/send`)
        .set("Authorization", `Bearer ${defaultToken}`);
    }
    await request(app).post("/tickets/tkt_9001/resolve").set("Authorization", `Bearer ${defaultToken}`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/embeddings");
    expect(res.status).toBe(401);
  });

  it("403s for a caller that isn't org_default, even with the embeddings:view permission", async () => {
    const res = await request(app).get("/embeddings").set("Authorization", `Bearer ${softwareAdminToken}`);
    expect(res.status).toBe(403);
  });

  it("lists org_default's resolution embeddings, joined to ticket + customer", async () => {
    const res = await request(app).get("/embeddings").set("Authorization", `Bearer ${defaultToken}`);
    expect(res.status).toBe(200);
    const row = res.body.data.embeddings.find((e: { ticket_id: string }) => e.ticket_id === "tkt_9001");
    expect(row).toBeDefined();
    expect(row).toMatchObject({
      ticket_id: "tkt_9001",
      category: "refund",
      customer_id: "cus_1001",
      customer_name: "Aisha Rao",
    });
    expect(row.ticket_subject).toEqual(expect.any(String));
    expect(row.source_text).toEqual(expect.any(String));
    // The raw 768-float vector is never returned to the client.
    expect(row.embedding).toBeUndefined();
  });
});
