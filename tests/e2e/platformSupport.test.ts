// V3-6 (LLD_v3 §4, HLD_v3 ADR-16): consent-gated, read-only cross-org
// platform support. Three independent gates enforced by the route: role
// permission (RBAC, covered in rbac.test.ts), caller org_id === "org_default",
// and the target org's own consent flag.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("platform support (V3-6)", () => {
  let defaultAdminToken: string;
  let defaultAgentToken: string;
  let softwareOrgId: string;
  let softwareOrgSlug: string;
  let softwareAdminToken: string;
  let softwareTicketId: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();

    const defaultLogin = await request(app)
      .post("/auth/login")
      .send({ username: "admin1", password: "admin123" });
    defaultAdminToken = defaultLogin.body.data.token;

    const agentLogin = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
    defaultAgentToken = agentLogin.body.data.token;

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
    softwareOrgId = createOrg.body.data.org.org_id;
    softwareOrgSlug = createOrg.body.data.org.slug;

    const softwareLogin = await request(app)
      .post("/auth/login")
      .send({ username: "acme_admin", password: "acmeadminpw" });
    softwareAdminToken = softwareLogin.body.data.token;

    const ticket = await request(app)
      .post("/tickets")
      .set("Authorization", `Bearer ${softwareAdminToken}`)
      .send({
        customer_id: createOrg.body.data.customer_ids[0],
        channel: "email",
        subject: "License question",
        body: "How do I transfer my license?",
      });
    softwareTicketId = ticket.body.data.ticket_id;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("GET/PUT /orgs/consent", () => {
    it("defaults to both flags false for a freshly onboarded org", async () => {
      const res = await request(app).get("/orgs/consent").set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ allow_platform_support: false, allow_platform_metrics: false });
    });

    it("independently toggles each flag", async () => {
      const res = await request(app)
        .put("/orgs/consent")
        .set("Authorization", `Bearer ${softwareAdminToken}`)
        .send({ allow_platform_support: true });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ allow_platform_support: true, allow_platform_metrics: false });
    });

    it("is scoped to the caller's own org — org_default's admin can't read the new org's consent", async () => {
      const res = await request(app).get("/orgs/consent").set("Authorization", `Bearer ${defaultAdminToken}`);
      expect(res.status).toBe(200);
      // org_default itself never had consent toggled — still its own defaults.
      expect(res.body.data).toEqual({ allow_platform_support: false, allow_platform_metrics: false });
    });
  });

  describe("GET /platform/tickets", () => {
    it("400s without a target_org_id", async () => {
      const res = await request(app).get("/platform/tickets").set("Authorization", `Bearer ${defaultAgentToken}`);
      expect(res.status).toBe(400);
    });

    it("403s for a caller that isn't org_default, even with the platform:tickets:view permission", async () => {
      const res = await request(app)
        .get("/platform/tickets")
        .query({ target_org_id: softwareOrgId })
        .set("Authorization", `Bearer ${softwareAdminToken}`);
      expect(res.status).toBe(403);
    });

    it("shows the new org's tickets once allow_platform_support is granted", async () => {
      const res = await request(app)
        .get("/platform/tickets")
        .query({ target_org_id: softwareOrgId })
        .set("Authorization", `Bearer ${defaultAgentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.map((t: { ticket_id: string }) => t.ticket_id)).toContain(softwareTicketId);
    });

    it("also resolves the target by slug, case-insensitively", async () => {
      const res = await request(app)
        .get("/platform/tickets")
        .query({ target_org_id: softwareOrgSlug.toLowerCase() })
        .set("Authorization", `Bearer ${defaultAgentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.map((t: { ticket_id: string }) => t.ticket_id)).toContain(softwareTicketId);
    });

    it("fetches the target org's thread via /platform/tickets/:id/messages", async () => {
      const res = await request(app)
        .get(`/platform/tickets/${softwareTicketId}/messages`)
        .query({ target_org_id: softwareOrgId })
        .set("Authorization", `Bearer ${defaultAgentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.messages.length).toBeGreaterThan(0);
    });

    it("403s again once consent is revoked", async () => {
      await request(app)
        .put("/orgs/consent")
        .set("Authorization", `Bearer ${softwareAdminToken}`)
        .send({ allow_platform_support: false });

      const res = await request(app)
        .get("/platform/tickets")
        .query({ target_org_id: softwareOrgId })
        .set("Authorization", `Bearer ${defaultAgentToken}`);
      expect(res.status).toBe(403);

      // restore for the metrics describe block below
      await request(app)
        .put("/orgs/consent")
        .set("Authorization", `Bearer ${softwareAdminToken}`)
        .send({ allow_platform_support: true });
    });
  });

  describe("GET /platform/metrics", () => {
    it("403s while allow_platform_metrics is false", async () => {
      const res = await request(app)
        .get("/platform/metrics")
        .query({ target_org_id: softwareOrgId })
        .set("Authorization", `Bearer ${defaultAgentToken}`);
      expect(res.status).toBe(403);
    });

    it("200s once allow_platform_metrics is granted, independent of allow_platform_support", async () => {
      await request(app)
        .put("/orgs/consent")
        .set("Authorization", `Bearer ${softwareAdminToken}`)
        .send({ allow_platform_metrics: true });

      const res = await request(app)
        .get("/platform/metrics")
        .query({ target_org_id: softwareOrgId })
        .set("Authorization", `Bearer ${defaultAgentToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("draft_acceptance_rate");
    });
  });
});
