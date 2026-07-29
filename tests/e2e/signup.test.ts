// V3-3 (LLD_v3 §2, HLD_v3 ADR-14): public, unauthenticated org-admin signup.
// Reuses createOrg() (same as the existing admin-only POST /orgs), but
// requires no auth at all and auto-logs the signer in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("POST /signup", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("201s with no Authorization header at all, creates org + admin + demo customers, and auto-logs in", async () => {
    const res = await request(app).post("/signup").send({
      name: "Widgets Inc",
      vertical: "retail_ecommerce",
      admin_username: "widgets_admin",
      admin_password: "widgetsadminpw",
      admin_display_name: "Widgets Admin",
    });

    expect(res.status).toBe(201);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.user).toEqual(
      expect.objectContaining({ display_name: "Widgets Admin", role: "admin" })
    );
    expect(res.body.data.org.slug).toBe("WIDGETS-INC");
    expect(res.body.data.document_ids.length).toBeGreaterThan(0);
    expect(res.body.data.customer_ids.length).toBe(4);

    // The returned token is immediately usable, scoped to the new org.
    const whoami = await request(app)
      .get("/tickets")
      .set("Authorization", `Bearer ${res.body.data.token}`);
    expect(whoami.status).toBe(200);
    expect(whoami.body.data.tickets).toEqual([]);
  });

  it("409s on a duplicate admin_username (same outcome as POST /orgs)", async () => {
    await request(app).post("/signup").send({
      name: "First Signup",
      vertical: "software",
      admin_username: "dup_signup_admin",
      admin_password: "whatever12",
      admin_display_name: "First",
    });
    const res = await request(app).post("/signup").send({
      name: "Second Signup",
      vertical: "software",
      admin_username: "dup_signup_admin",
      admin_password: "whatever12",
      admin_display_name: "Second",
    });
    expect(res.status).toBe(409);
  });

  it("400s on an invalid vertical", async () => {
    const res = await request(app).post("/signup").send({
      name: "Bad Vertical Co",
      vertical: "not-a-real-vertical",
      admin_username: "bad_vertical_signup",
      admin_password: "whatever12",
      admin_display_name: "X",
    });
    expect(res.status).toBe(400);
  });

  it("400s on a password shorter than the 8-char minimum", async () => {
    const res = await request(app).post("/signup").send({
      name: "Short Pw Co",
      vertical: "finance",
      admin_username: "short_pw_admin",
      admin_password: "short",
      admin_display_name: "X",
    });
    expect(res.status).toBe(400);
  });

  it("429s past the rate limit", async () => {
    // The limiter is a single in-process instance shared across every test
    // in this file (and the whole process), so earlier tests above have
    // already consumed some of the window's quota — don't assume a precise
    // count, just drive enough requests to be certain the limit trips.
    let lastStatus = 200;
    for (let i = 0; i < 15 && lastStatus !== 429; i++) {
      const res = await request(app)
        .post("/signup")
        .send({ name: `Rl Co ${i}`, vertical: "software", admin_username: `rl_admin_${i}` });
      lastStatus = res.status;
      if (lastStatus === 429) {
        expect(res.body.error.code).toBe("RATE_LIMITED");
      }
    }
    expect(lastStatus).toBe(429);
  });
});
