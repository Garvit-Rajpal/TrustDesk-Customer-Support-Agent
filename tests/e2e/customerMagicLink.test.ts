// V5-19/20 (LLD_v5 §6, HLD_v5 ADR-29): POST /customer-auth/magic-link/request
// and /consume. Uses a dedicated app instance built with a MockEmailAdapter
// this file can inspect (`sent`) — mirrors autoSend.test.ts's buildApp(...)
// pattern for tests that need to introspect an adapter the default `app`
// export doesn't expose.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../../src/app.js";
import { MockModelAdapter } from "../../src/adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "../../src/adapters/defaultMockScenarios.js";
import { MockEmbeddingAdapter } from "../../src/adapters/mockEmbedding.js";
import { MockEmailAdapter } from "../../src/adapters/mockEmail.js";
import { insertMagicLink } from "../../src/db/repos/customerMagicLinksRepo.js";
import { verifyCustomerToken } from "../../src/services/tokens.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { ORG_DEFAULT } from "../helpers/org.js";

function extractToken(text: string): string {
  const match = text.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error("no token found in email body");
  return match[1]!;
}

describe("magic-link customer auth (V5-19/20)", () => {
  const emailAdapter = new MockEmailAdapter();
  const testApp = buildApp(new MockModelAdapter(DEFAULT_MODEL_SCENARIOS), new MockEmbeddingAdapter(), emailAdapter);

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  // V5-19 seed fixtures: cus_1001/aisha.rao@example.com owns tkt_9001;
  // tkt_9002 belongs to cus_1002, not cus_1001 (used below as the
  // "known customer, unowned ticket" case).
  //
  // The route's rate limiter caps this whole describe block at 5
  // successful requests per hour/IP (same 5/hour limiter shape /verify
  // uses) — the six `it`s below spend exactly 5 successes then a 6th to
  // observe the 429, same budgeting discipline tests/e2e/customerAuth.test.ts
  // established for /verify.
  describe("POST /customer-auth/magic-link/request", () => {
    it("200s generically and sends a real email for a known org+email, no ticket_id (1/5)", async () => {
      const res = await request(testApp)
        .post("/customer-auth/magic-link/request")
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ ok: true });
      expect(emailAdapter.sent).toHaveLength(1);
      const sent = emailAdapter.sent[0]!;
      expect(sent.to).toBe("aisha.rao@example.com");
      expect(sent.text).toMatch(/portal\/magic-link\?token=[a-f0-9]{64}/);
    });

    it("200s and sends a ticket-scoped email when ticket_id belongs to the customer (2/5)", async () => {
      const res = await request(testApp)
        .post("/customer-auth/magic-link/request")
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com", ticket_id: "tkt_9001" });

      expect(res.status).toBe(200);
      expect(emailAdapter.sent).toHaveLength(2);

      const rawToken = extractToken(emailAdapter.sent[1]!.text);
      const consumeRes = await request(testApp).post("/customer-auth/magic-link/consume").send({ token: rawToken });
      expect(consumeRes.status).toBe(200);
      expect(consumeRes.body.data.ticket_id).toBe("tkt_9001");
    });

    it("200s and sends an unscoped email when ticket_id belongs to a DIFFERENT customer — silently ignored, not an error (3/5)", async () => {
      const res = await request(testApp)
        .post("/customer-auth/magic-link/request")
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com", ticket_id: "tkt_9002" });

      expect(res.status).toBe(200);
      expect(emailAdapter.sent).toHaveLength(3);

      const rawToken = extractToken(emailAdapter.sent[2]!.text);
      const consumeRes = await request(testApp).post("/customer-auth/magic-link/consume").send({ token: rawToken });
      expect(consumeRes.status).toBe(200);
      expect(consumeRes.body.data.ticket_id).toBeUndefined();
    });

    it("200s generically for an unknown org — no email sent, identical response shape (4/5)", async () => {
      const res = await request(testApp)
        .post("/customer-auth/magic-link/request")
        .send({ org_slug: "NOT-A-REAL-ORG", email: "aisha.rao@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ ok: true });
      expect(emailAdapter.sent).toHaveLength(3);
    });

    it("200s generically but skips sending once the per-customer abuse guard trips (5/5)", async () => {
      // 3 real links already exist for cus_1001 from the tests above —
      // at the guard's threshold (3), this 4th attempt must be silently
      // skipped: same generic 200, no 4th email.
      const res = await request(testApp)
        .post("/customer-auth/magic-link/request")
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ ok: true });
      expect(emailAdapter.sent).toHaveLength(3);
    });

    it("429s once the 5/hour/IP quota already spent above is exceeded (6th request)", async () => {
      const res = await request(testApp)
        .post("/customer-auth/magic-link/request")
        .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com" });
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe("RATE_LIMITED");
    });
  });

  describe("POST /customer-auth/magic-link/consume", () => {
    async function seedLink(overrides: { expires_at?: Date; ticket_id?: string } = {}) {
      const rawToken = `raw-${Math.random().toString(16).slice(2)}-${Date.now()}`;
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");
      await insertMagicLink(ORG_DEFAULT, {
        link_id: `mlk_test_${Math.random().toString(16).slice(2)}`,
        customer_id: "cus_1001",
        token_hash: tokenHash,
        expires_at: overrides.expires_at ?? new Date(Date.now() + 15 * 60 * 1000),
        ticket_id: overrides.ticket_id,
      });
      return rawToken;
    }

    it("happy path: mints a 30-day CustomerToken, same response shape as /verify", async () => {
      const rawToken = await seedLink();
      const res = await request(testApp).post("/customer-auth/magic-link/consume").send({ token: rawToken });

      expect(res.status).toBe(200);
      expect(res.body.data.customer_token).toEqual(expect.any(String));
      expect(res.body.data.customer.customer_id).toBe("cus_1001");
      expect(res.body.data.customer.name).toBe("Aisha Rao");

      const claims = verifyCustomerToken(res.body.data.customer_token);
      expect(claims).toEqual({ customer_id: "cus_1001", org_id: "org_default", kind: "customer" });

      // 30d expiry, not /verify's 1h — decode without verifying to read `exp`/`iat` directly.
      const jwt = await import("jsonwebtoken");
      const decoded = jwt.default.decode(res.body.data.customer_token) as { iat: number; exp: number };
      const lifetimeSeconds = decoded.exp - decoded.iat;
      expect(lifetimeSeconds).toBeCloseTo(30 * 24 * 60 * 60, -2);
    });

    it("401s generically for an expired link", async () => {
      const rawToken = await seedLink({ expires_at: new Date(Date.now() - 1000) });
      const res = await request(testApp).post("/customer-auth/magic-link/consume").send({ token: rawToken });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
      expect(res.body.error.message).toBe("Link expired or already used");
    });

    it("401s generically for a token that never existed (tampered/guessed)", async () => {
      const res = await request(testApp)
        .post("/customer-auth/magic-link/consume")
        .send({ token: "not-a-real-token-0123456789abcdef" });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe("Link expired or already used");
    });

    // Explicit contrast test (not an idempotency test): consuming the same
    // magic-link token twice must REJECT the second attempt with a fresh
    // 401 — it must NOT replay the first attempt's cached success the way
    // idempotency_key replay (invariant #7) does elsewhere in this suite.
    // Do not "fix" this to return the first result on a second hit — that
    // would silently turn a single-use credential into a reusable one.
    it("rejects (not replays) a second consumption of the same token", async () => {
      const rawToken = await seedLink();

      const first = await request(testApp).post("/customer-auth/magic-link/consume").send({ token: rawToken });
      expect(first.status).toBe(200);
      const firstToken = first.body.data.customer_token;

      const second = await request(testApp).post("/customer-auth/magic-link/consume").send({ token: rawToken });
      expect(second.status).toBe(401);
      expect(second.body.error.message).toBe("Link expired or already used");
      expect(second.body.data).toBeUndefined();
      // Not the same token replayed back — there is no second customer_token at all.
      expect(second.body.data?.customer_token).not.toBe(firstToken);
    });

    it("400s on a missing token", async () => {
      const res = await request(testApp).post("/customer-auth/magic-link/consume").send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // V5-21: confirms /verify's token expiry is byte-identical to v4 — the
  // opts param signCustomerToken() gained is additive, and /verify's call
  // site still passes no second argument. Uses its own rate limiter
  // (customerVerifyRateLimiter), so this one request doesn't compete with
  // the magic-link budget above.
  it("POST /customer-auth/verify still mints a 1h token, unchanged from v4", async () => {
    const res = await request(testApp)
      .post("/customer-auth/verify")
      .send({ org_slug: "DEFAULT", email: "aisha.rao@example.com", ticket_id: "tkt_9001" });
    expect(res.status).toBe(200);

    const jwt = await import("jsonwebtoken");
    const decoded = jwt.default.decode(res.body.data.customer_token) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(60 * 60);
  });
});
