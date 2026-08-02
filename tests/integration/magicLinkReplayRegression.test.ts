// V5-25 (LLD_v5 §7, HLD_v5 ADR-29): permanent adversarial regression test,
// joining eval_005/006/007 and portalInjectionRegression.test.ts as a
// standing case that must stay green forever (CLAUDE.md methodology) —
// never deleted or skipped. Proves invariant #8's v5 amendment end-to-end
// against the *real* POST /customer-auth/magic-link/consume route (not the
// repo-level markMagicLinkConsumed() unit coverage in
// customerMagicLinksRepo.test.ts, and not the dedicated-testApp e2e coverage
// in tests/e2e/customerMagicLink.test.ts — this uses the same default `app`
// export every other permanent regression test in this directory imports,
// closing the loop that the real wiring, not just an adapter-injected test
// double, rejects a replayed magic-link token).
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { insertMagicLink } from "../../src/db/repos/customerMagicLinksRepo.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { ORG_DEFAULT } from "../helpers/org.js";

describe("a consumed magic-link token is rejected, not replayed, through the real route (V5-25)", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("second POST /customer-auth/magic-link/consume for the same token 401s instead of returning the first success again", async () => {
    const rawToken = "replay-regression-token-0123456789abcdef";
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_replay_regression",
      customer_id: "cus_1001",
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });

    const first = await request(app).post("/customer-auth/magic-link/consume").send({ token: rawToken });
    expect(first.status).toBe(200);
    const firstCustomerToken = first.body.data.customer_token;
    expect(firstCustomerToken).toEqual(expect.any(String));

    // Do not "fix" this to return the first result on replay — invariant #7's
    // idempotency-key semantics are deliberately inverted here (HLD_v5
    // ADR-29): a magic link is a single-use credential, not an idempotent
    // operation, so a second consumption must fail closed.
    const second = await request(app).post("/customer-auth/magic-link/consume").send({ token: rawToken });
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe("UNAUTHENTICATED");
    expect(second.body.data).toBeUndefined();
  });
});
