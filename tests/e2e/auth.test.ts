// Milestone 2 (LLD §9): auth — 401 without/with-bad token; login issues a
// verifiable JWT. Thin E2E over the real Express app + supertest (LLD §1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import express from "express";
import request from "supertest";
import { app } from "../../src/app.js";
import { authMiddleware } from "../../src/api/middleware/auth.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("auth", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("POST /auth/login", () => {
    it("issues a verifiable JWT for correct seeded credentials", async () => {
      const res = await request(app)
        .post("/auth/login")
        .send({ username: "agent1", password: "agent123" });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toEqual(expect.any(String));
      expect(res.body.data.user.display_name).toEqual(expect.any(String));
      expect(res.body.data.user.user_id).toMatch(/^usr_/);

      const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET as string) as jwt.JwtPayload;
      expect(decoded.sub).toBe(res.body.data.user.user_id);
      expect(decoded.name).toBe(res.body.data.user.display_name);
      expect(decoded.role).toBe("agent");
    });

    it("rejects a wrong password with 401", async () => {
      const res = await request(app)
        .post("/auth/login")
        .send({ username: "agent1", password: "wrong-password" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects an unknown username with 401", async () => {
      const res = await request(app)
        .post("/auth/login")
        .send({ username: "nobody", password: "whatever" });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("400s on a malformed request body", async () => {
      const res = await request(app).post("/auth/login").send({ username: "agent1" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // authMiddleware is exercised here against a throwaway router rather than a
  // route baked into src/app.ts — the real app has no protected routes yet
  // (those land in milestone 3), but the middleware contract must hold now.
  describe("authMiddleware", () => {
    function protectedApp() {
      const testApp = express();
      testApp.get("/probe", authMiddleware, (req, res) => {
        res.json({ data: { reviewer_id: req.user?.sub } });
      });
      testApp.use((req, res) => {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "not found" } });
      });
      return testApp;
    }

    it("401s with no Authorization header", async () => {
      const res = await request(protectedApp()).get("/probe");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("401s with a garbage token", async () => {
      const res = await request(protectedApp())
        .get("/probe")
        .set("Authorization", "Bearer not-a-real-token");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("401s with a token signed by the wrong secret", async () => {
      const forged = jwt.sign({ sub: "usr_fake", name: "Fake", role: "agent" }, "wrong-secret");
      const res = await request(protectedApp())
        .get("/probe")
        .set("Authorization", `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it("passes through with a valid token", async () => {
      const login = await request(app)
        .post("/auth/login")
        .send({ username: "agent1", password: "agent123" });

      const res = await request(protectedApp())
        .get("/probe")
        .set("Authorization", `Bearer ${login.body.data.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.reviewer_id).toBe(login.body.data.user.user_id);
    });
  });
});
