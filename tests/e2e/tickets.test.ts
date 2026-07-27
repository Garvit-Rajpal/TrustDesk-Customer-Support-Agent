// Milestone 3 (LLD §9): ticket APIs — "ticket fetch joins context".
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("ticket APIs", () => {
  let token: string;

  beforeAll(async () => {
    await truncateAll();
    await runSeed();
    const login = await request(app)
      .post("/auth/login")
      .send({ username: "agent1", password: "agent123" });
    token = login.body.data.token;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("GET /tickets", () => {
    it("401s without a token", async () => {
      const res = await request(app).get("/tickets");
      expect(res.status).toBe(401);
    });

    it("lists all seeded tickets with no expected_* labels", async () => {
      const res = await request(app).get("/tickets").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets).toHaveLength(8);
      const t = res.body.data.tickets.find((x: any) => x.ticket_id === "tkt_9001");
      expect(t).toBeDefined();
      expect(t).not.toHaveProperty("expected_category");
      expect(t).not.toHaveProperty("expected_actions");
      expect(t.triage).toBeNull();
    });

    it("filters by status", async () => {
      const res = await request(app)
        .get("/tickets?status=open")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.tickets.length).toBe(8);

      const none = await request(app)
        .get("/tickets?status=closed")
        .set("Authorization", `Bearer ${token}`);
      expect(none.body.data.tickets).toHaveLength(0);
    });
  });

  describe("GET /tickets/:id", () => {
    it("returns ticket + customer + order context, no expected_* labels", async () => {
      const res = await request(app)
        .get("/tickets/tkt_9001")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.ticket.ticket_id).toBe("tkt_9001");
      expect(res.body.data.ticket.body).toContain("BlueBuds Air");
      expect(res.body.data.ticket).not.toHaveProperty("expected_category");
      expect(res.body.data.customer.customer_id).toBe("cus_1001");
      expect(res.body.data.customer.name).toBe("Aisha Rao");
      expect(res.body.data.order.order_id).toBe("ord_5001");
    });

    it("404s for an unknown ticket", async () => {
      const res = await request(app)
        .get("/tickets/tkt_does_not_exist")
        .set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /tickets", () => {
    it("creates a ticket and preserves the body verbatim", async () => {
      const res = await request(app)
        .post("/tickets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          customer_id: "cus_1001",
          order_id: "ord_5001",
          channel: "email",
          subject: "New demo ticket",
          body: "  Exact original text, not to be mutated.  ",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.ticket_id).toMatch(/^tkt_/);
      expect(res.body.data.body).toBe("  Exact original text, not to be mutated.  ");

      const fetched = await request(app)
        .get(`/tickets/${res.body.data.ticket_id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(fetched.body.data.ticket.body).toBe("  Exact original text, not to be mutated.  ");
    });

    it("400s for an unknown customer_id", async () => {
      const res = await request(app)
        .post("/tickets")
        .set("Authorization", `Bearer ${token}`)
        .send({ customer_id: "cus_nope", channel: "email", subject: "x", body: "y" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("400s when order_id does not belong to customer_id", async () => {
      const res = await request(app)
        .post("/tickets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          customer_id: "cus_1001",
          order_id: "ord_5002", // belongs to cus_1002
          channel: "email",
          subject: "x",
          body: "y",
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
