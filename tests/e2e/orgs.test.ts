// V2-5 (LLD_v2 §6/§9): "two-org isolation suite (zero cross-org leakage);
// pack stamping produces prefixed doc IDs; v1 eval metrics unchanged on
// org_default." POST /orgs onboarding, policy pack stamping, and the
// cross-org isolation boundary on every list/fetch/search endpoint.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { upsertCustomer } from "../../src/db/repos/customersRepo.js";
import { insertTicket } from "../../src/db/repos/ticketsRepo.js";
import { newTicketId } from "../../src/domain/ids.js";

describe("multi-tenancy (LLD_v2 §6)", () => {
  let defaultAdminToken: string;
  let softwareOrgId: string;
  let softwareOrgSlug: string;
  let softwareAdminToken: string;
  let softwareDocIds: string[];
  let createOrgResponse: request.Response;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();

    const defaultLogin = await request(app)
      .post("/auth/login")
      .send({ username: "admin1", password: "admin123" });
    defaultAdminToken = defaultLogin.body.data.token;

    const createOrg = await request(app)
      .post("/orgs")
      .set("Authorization", `Bearer ${defaultAdminToken}`)
      .send({
        name: "Acme Software",
        vertical: "software",
        admin_username: "acme_admin",
        admin_password: "acmeadminpw",
        admin_display_name: "Acme Admin",
      });
    expect(createOrg.status).toBe(201);
    softwareOrgId = createOrg.body.data.org.org_id;
    softwareOrgSlug = createOrg.body.data.org.slug;
    softwareDocIds = createOrg.body.data.document_ids;
    createOrgResponse = createOrg;

    const softwareLogin = await request(app)
      .post("/auth/login")
      .send({ username: "acme_admin", password: "acmeadminpw" });
    softwareAdminToken = softwareLogin.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("POST /orgs (LLD_v2 §6): org onboarding + policy pack stamping", () => {
    it("creates the org with the requested vertical", async () => {
      const res = await request(app)
        .get(`/documents`)
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
    });

    it("stamps exactly the software pack's docs, prefixed with the org's slug (not the opaque org_id)", async () => {
      expect(softwareOrgSlug).toBe("ACME-SOFTWARE");
      expect(softwareDocIds.length).toBe(4);
      for (const docId of softwareDocIds) {
        expect(docId.startsWith(`${softwareOrgSlug}-KB-`)).toBe(true);
      }
      const baseIds = softwareDocIds.map((id) => id.replace(`${softwareOrgSlug}-`, ""));
      expect(baseIds.sort()).toEqual(
        ["KB-LICENSE-001", "KB-REFUND-TERMS-001", "KB-SECURITY-001", "KB-SUBSCRIPTION-001"].sort()
      );
    });

    it("disambiguates a name that slugifies to an already-taken slug", async () => {
      // "Acme Software!!" slugifies to the same "ACME-SOFTWARE" base as the
      // org created in beforeAll — must not 500 on the UNIQUE constraint.
      const res = await request(app)
        .post("/orgs")
        .set("Authorization", `Bearer ${defaultAdminToken}`)
        .send({
          name: "Acme Software!!",
          vertical: "finance",
          admin_username: "acme_admin_2",
          admin_password: "whatever12",
          admin_display_name: "Someone Else",
        });
      expect(res.status).toBe(201);
      expect(res.body.data.org.slug).toBe("ACME-SOFTWARE-2");
      expect(res.body.data.document_ids[0]).toMatch(/^ACME-SOFTWARE-2-KB-/);
    });

    it("seeds demo customers so the new org can create tickets immediately (V3-2)", async () => {
      expect(createOrgResponse.body.data.customer_ids.length).toBe(4);
      const res = await request(app)
        .get("/customers")
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.customers.map((c: { customer_id: string }) => c.customer_id).sort()).toEqual(
        [...createOrgResponse.body.data.customer_ids].sort()
      );
    });

    it("403s for an admin who isn't org_default's", async () => {
      const res = await request(app)
        .post("/orgs")
        .set("Authorization", `Bearer ${softwareAdminToken}`)
        .send({
          name: "Some Other Org",
          vertical: "finance",
          admin_username: "someone_else_admin",
          admin_password: "whatever12",
          admin_display_name: "X",
        });
      expect(res.status).toBe(403);
    });

    it("logs the new admin in immediately, JWT scoped to the new org", async () => {
      const res = await request(app)
        .post("/auth/login")
        .send({ username: "acme_admin", password: "acmeadminpw" });
      expect(res.status).toBe(200);
      expect(res.body.data.user.role).toBe("admin");
      expect(res.body.data.user.org_id).toBe(softwareOrgId);
    });

    it("409s on a duplicate admin_username", async () => {
      const res = await request(app)
        .post("/orgs")
        .set("Authorization", `Bearer ${defaultAdminToken}`)
        .send({
          name: "Another Org",
          vertical: "finance",
          admin_username: "acme_admin",
          admin_password: "whatever12",
          admin_display_name: "Someone Else",
        });
      expect(res.status).toBe(409);
    });

    it("400s on an invalid vertical", async () => {
      const res = await request(app)
        .post("/orgs")
        .set("Authorization", `Bearer ${defaultAdminToken}`)
        .send({
          name: "Bad Vertical Org",
          vertical: "not-a-real-vertical",
          admin_username: "bad_vertical_admin",
          admin_password: "whatever12",
          admin_display_name: "X",
        });
      expect(res.status).toBe(400);
    });
  });

  describe("cross-org isolation: the new org sees none of org_default's data", () => {
    it("GET /documents returns only the 4 stamped docs, not org_default's 8 v1 docs", async () => {
      const res = await request(app).get("/documents").set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
      const docIds = res.body.data.documents.map((d: { doc_id: string }) => d.doc_id);
      expect(docIds.sort()).toEqual([...softwareDocIds].sort());
      expect(docIds).not.toContain("KB-REFUND-001");
      expect(docIds).not.toContain("KB-ADVERSARIAL-001");
    });

    it("GET /documents/:docId 404s on org_default's unprefixed doc id", async () => {
      const res = await request(app)
        .get("/documents/KB-REFUND-001")
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(404);
    });

    it("GET /documents/:docId works for the new org's own prefixed doc", async () => {
      const res = await request(app)
        .get(`/documents/${softwareDocIds[0]}`)
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
    });

    it("GET /documents/search never surfaces org_default's docs, even on a shared term", async () => {
      const res = await request(app)
        .get("/documents/search")
        .query({ q: "refund" })
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
      const docIds = res.body.data.results.map((r: { doc_id: string }) => r.doc_id);
      expect(docIds).not.toContain("KB-REFUND-001");
      for (const id of docIds) {
        expect(id.startsWith(`${softwareOrgSlug}-`)).toBe(true);
      }
    });

    it("GET /tickets returns an empty list for the brand-new org", async () => {
      const res = await request(app).get("/tickets").set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets).toEqual([]);
    });

    it("GET /tickets/:id 404s on an org_default ticket id", async () => {
      const res = await request(app)
        .get("/tickets/tkt_9001")
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(404);
    });

    it("GET /metrics/agent-quality never blends the new org's zero activity with org_default's", async () => {
      const res = await request(app)
        .get("/metrics/agent-quality")
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.draft_acceptance_rate).toBeNull();
      expect(res.body.data.action_approval_rate).toBeNull();
    });
  });

  describe("reverse direction: org_default cannot see the new org's data", () => {
    let softwareTicketId: string;

    beforeAll(async () => {
      // Fabricate a ticket directly in the new org via a customer id that
      // deliberately isn't one of the V3-2 demo customers, to keep this
      // fixture independent of that seeding detail.
      const ctx = { org_id: softwareOrgId };
      await upsertCustomer(
        {
          customer_id: "cus_acme_1",
          name: "Acme Test Customer",
          email: "test@acme.example",
          tier: "standard",
          country: "US",
          verified: true,
          tags: [],
          created_at: new Date().toISOString(),
        },
        softwareOrgId
      );
      const ticket = await insertTicket(ctx, {
        ticket_id: newTicketId(),
        customer_id: "cus_acme_1",
        order_id: null,
        channel: "email",
        subject: "License question",
        body: "How do I transfer my license?",
        created_at: new Date().toISOString(),
      });
      softwareTicketId = ticket.ticket_id;
    });

    it("org_default's agent gets 404 on the new org's ticket id", async () => {
      const login = await request(app)
        .post("/auth/login")
        .send({ username: "agent1", password: "agent123" });
      const res = await request(app)
        .get(`/tickets/${softwareTicketId}`)
        .set("Authorization", `Bearer ${login.body.data.token}`);
      expect(res.status).toBe(404);
    });

    it("the new org's own admin can fetch it", async () => {
      const res = await request(app)
        .get(`/tickets/${softwareTicketId}`)
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.ticket.ticket_id).toBe(softwareTicketId);
    });
  });
});
