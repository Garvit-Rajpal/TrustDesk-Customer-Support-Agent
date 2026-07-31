// W17 (LLD_v4 §7, HLD_v4 ADR-23): CustomerToken sign/verify +
// customerAuthMiddleware. V4-19 milestone — no /portal/* route exists in
// src/app.ts yet (that lands in V4-20/22/24), so customerAuthMiddleware is
// exercised against a throwaway router, same pattern tests/e2e/auth.test.ts
// established for authMiddleware before milestone 3 added protected routes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { app } from "../../src/app.js";
import { customerAuthMiddleware } from "../../src/api/middleware/customerAuthMiddleware.js";
import { signCustomerToken, signToken, verifyCustomerToken } from "../../src/services/tokens.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("W17 customer token", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("signCustomerToken / verifyCustomerToken", () => {
    it("round-trips claims", () => {
      const token = signCustomerToken({ customer_id: "cus_1", org_id: "org_default", kind: "customer" });
      const claims = verifyCustomerToken(token);
      expect(claims).toEqual({ customer_id: "cus_1", org_id: "org_default", kind: "customer" });
    });

    it("preserves an optional ticket_id", () => {
      const token = signCustomerToken({
        customer_id: "cus_1",
        org_id: "org_default",
        ticket_id: "tkt_1",
        kind: "customer",
      });
      expect(verifyCustomerToken(token).ticket_id).toBe("tkt_1");
    });

    it("rejects a decoded agent TokenClaims payload (no `kind` field)", () => {
      const agentToken = signToken({ sub: "usr_1", name: "Agent", role: "agent", org_id: "org_default" });
      expect(() => verifyCustomerToken(agentToken)).toThrow();
    });
  });

  describe("customerAuthMiddleware", () => {
    function portalProbeApp() {
      const testApp = express();
      testApp.get("/portal/probe", customerAuthMiddleware, (req, res) => {
        res.json({ data: req.customerContext });
      });
      testApp.use((req, res) => {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "not found" } });
      });
      return testApp;
    }

    it("401s with no token at all", async () => {
      const res = await request(portalProbeApp()).get("/portal/probe");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("401s an agent JWT presented as a customer token", async () => {
      const agentToken = signToken({ sub: "usr_1", name: "Agent", role: "agent", org_id: "org_default" });
      const res = await request(portalProbeApp())
        .get("/portal/probe")
        .set("Authorization", `Bearer ${agentToken}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("passes through with a valid customer token, header form", async () => {
      const token = signCustomerToken({ customer_id: "cus_1", org_id: "org_default", kind: "customer" });
      const res = await request(portalProbeApp())
        .get("/portal/probe")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ customer_id: "cus_1", org_id: "org_default" });
    });

    it("passes through with a valid customer token via ?token= (WS handshake accommodation)", async () => {
      const token = signCustomerToken({ customer_id: "cus_1", org_id: "org_default", kind: "customer" });
      const res = await request(portalProbeApp()).get(`/portal/probe?token=${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.customer_id).toBe("cus_1");
    });

    it("401s an expired customer token", async () => {
      // jsonwebtoken rejects a negative expiresIn as already-expired at sign time.
      const jwt = await import("jsonwebtoken");
      const expired = jwt.default.sign(
        { customer_id: "cus_1", org_id: "org_default", kind: "customer" },
        process.env.JWT_SECRET as string,
        { algorithm: "HS256", expiresIn: -1 }
      );
      const res = await request(portalProbeApp())
        .get("/portal/probe")
        .set("Authorization", `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });
  });

  // "customer token rejected on every requirePermission()-guarded route" —
  // no new middleware needed for this direction: authMiddleware decodes the
  // customer token fine (same JWT_SECRET), but it has no `role` field, so
  // requirePermission() rejects it by construction (roleHasPermission
  // (undefined, ...) is always false for every permission).
  describe("agent routes reject a customer token", () => {
    it("403s GET /tickets (requirePermission) with a customer token", async () => {
      const token = signCustomerToken({ customer_id: "cus_1", org_id: "org_default", kind: "customer" });
      const res = await request(app).get("/tickets").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("403s GET /customers (requirePermission) with a customer token", async () => {
      const token = signCustomerToken({ customer_id: "cus_1", org_id: "org_default", kind: "customer" });
      const res = await request(app).get("/customers").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  // V4-20 (LLD_v4 §7): seed fixtures — cus_1001/aisha.rao@example.com owns
  // ord_5001 and tkt_9001; cus_1002 owns ord_5002 (used below as a
  // known-email-but-mismatched-order case).
  //
  // The route's rate limiter caps this whole describe block at 5 requests
  // per hour (LLD_v4 §7: 5/hour/IP, deliberately stricter than /signup's
  // 10/hour) — every `it` below that hits POST /customer-auth/verify with a
  // real, distinguishable assertion is budgeted into exactly 5 requests so
  // none of them collide with the limit; the dedicated rate-limit test then
  // starts from an already-exhausted quota and expects 429 on its very
  // first request. Body-shape validation (neither/both of order_id,
  // ticket_id) is covered at the schema level instead of here, precisely so
  // it doesn't compete for this same tight budget.
  describe("POST /customer-auth/verify", () => {
    it("200s order-scoped (lowercase org_slug, mirrors getOrgBySlug's uppercasing): issues a usable customer_token, no ticket_id in the response", async () => {
      const res = await request(app)
        .post("/customer-auth/verify")
        .send({ org_slug: "default", email: "aisha.rao@example.com", order_id: "ord_5001" });

      expect(res.status).toBe(200);
      expect(res.body.data.customer_token).toEqual(expect.any(String));
      expect(res.body.data.customer).toEqual({ customer_id: "cus_1001", name: "Aisha Rao" });
      expect(res.body.data.ticket_id).toBeUndefined();

      const claims = verifyCustomerToken(res.body.data.customer_token);
      expect(claims).toEqual({ customer_id: "cus_1001", org_id: "org_default", kind: "customer" });
    });

    it("200s ticket-scoped: response and token both carry ticket_id", async () => {
      const res = await request(app)
        .post("/customer-auth/verify")
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com", ticket_id: "tkt_9001" });

      expect(res.status).toBe(200);
      expect(res.body.data.ticket_id).toBe("tkt_9001");
      const claims = verifyCustomerToken(res.body.data.customer_token);
      expect(claims.ticket_id).toBe("tkt_9001");
    });

    it("401s an unknown org slug with the generic message", async () => {
      const res = await request(app)
        .post("/customer-auth/verify")
        .send({ org_slug: "NOT-A-REAL-ORG", email: "aisha.rao@example.com", order_id: "ord_5001" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
      expect(res.body.error.message).toBe("Verification failed");
    });

    it("401s an unknown email with the identical generic message", async () => {
      const res = await request(app)
        .post("/customer-auth/verify")
        .send({ org_slug: "DEFAULT", email: "nobody@example.com", order_id: "ord_5001" });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("Verification failed");
    });

    it("401s a known email with an order_id belonging to a different customer, identical message (5th and final request before this block's quota is exhausted)", async () => {
      const res = await request(app)
        .post("/customer-auth/verify")
        // aisha.rao (cus_1001) does not own ord_5002 (cus_1002's order).
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com", order_id: "ord_5002" });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("Verification failed");
    });

    it("429s immediately once the 5/hour/IP quota already spent above is exceeded", async () => {
      const res = await request(app)
        .post("/customer-auth/verify")
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com", order_id: "ord_5001" });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("RATE_LIMITED");
    });
  });
});
