// Milestone 3: documents API — ingest (re-runnable, preserves doc_id),
// search, list, fetch (LLD §4.2-4.3).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("documents API", () => {
  let token: string;
  // V2-2 (LLD_v2 §3): document ingestion is admin-only.
  let adminToken: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;

    const adminLogin = await request(app)
      .post("/auth/login")
      .send({ username: "admin1", password: "admin123" });
    adminToken = adminLogin.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("POST /documents/ingest", () => {
    it("ingests a new document, preserving doc_id verbatim", async () => {
      const res = await request(app)
        .post("/documents/ingest")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          documents: [
            {
              doc_id: "KB-TEST-999",
              title: "Test Doc",
              content: "Some test policy content about gizmos.",
              source_path: "test/gizmo.md",
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.ingested).toBe(1);
      expect(res.body.data.document_ids).toEqual(["KB-TEST-999"]);
    });

    it("is re-runnable: unchanged content is not rewritten", async () => {
      const payload = {
        documents: [
          {
            doc_id: "KB-TEST-999",
            title: "Test Doc",
            content: "Some test policy content about gizmos.",
            source_path: "test/gizmo.md",
          },
        ],
      };
      const first = await request(app)
        .post("/documents/ingest")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload);
      expect(first.body.data.ingested).toBe(0); // already ingested above, checksum unchanged
      expect(first.body.data.document_ids).toEqual(["KB-TEST-999"]);
    });
  });

  describe("GET /documents/search", () => {
    it("returns ranked results with doc_id, title, snippet, score, audience", async () => {
      const res = await request(app)
        .get("/documents/search")
        .query({ q: "damaged replacement" })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.query).toBe("damaged replacement");
      expect(res.body.data.results[0].doc_id).toBe("KB-REFUND-001");
      expect(res.body.data.results[0]).toEqual(
        expect.objectContaining({
          doc_id: expect.any(String),
          title: expect.any(String),
          snippet: expect.any(String),
          score: expect.any(Number),
          audience: expect.any(String),
        })
      );
    });

    it("400s when q is missing", async () => {
      const res = await request(app)
        .get("/documents/search")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  describe("GET /documents and GET /documents/:docId", () => {
    it("lists ingested documents", async () => {
      const res = await request(app).get("/documents").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const docIds = res.body.data.documents.map((d: any) => d.doc_id);
      expect(docIds).toContain("KB-REFUND-001");
      expect(docIds).toContain("KB-ADVERSARIAL-001");
    });

    it("fetches a single document by ID", async () => {
      const res = await request(app)
        .get("/documents/KB-REFUND-001")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.doc_id).toBe("KB-REFUND-001");
      expect(res.body.data.content).toContain("Refund");
      expect(res.body.data.audience).toBe("Customer support agents");
    });

    it("404s for an unknown doc", async () => {
      const res = await request(app)
        .get("/documents/KB-NOPE-000")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });
});
