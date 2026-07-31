// V2-5 follow-up: POST /customers + GET /customers. Added because a freshly
// onboarded org (V2-5) starts with zero customers and, without this,
// couldn't create a ticket either (POST /tickets requires an existing
// customer_id). Also covers org isolation, same as every other list/create
// endpoint added in V2-5.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";

describe("customers API", () => {
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

  it("401s without a token", async () => {
    const res = await request(app).post("/customers").send({});
    expect(res.status).toBe(401);
  });

  it("creates a customer with generated id and defaults", async () => {
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Jamie Rivera", email: "jamie@example.com", country: "US" });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({
      customer_id: expect.stringMatching(/^cus_/),
      name: "Jamie Rivera",
      email: "jamie@example.com",
      tier: "standard",
      country: "US",
      verified: false,
      tags: [],
      created_at: expect.any(String),
    });
  });

  it("400s on an invalid email", async () => {
    const res = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad Email", email: "not-an-email", country: "US" });
    expect(res.status).toBe(400);
  });

  it("400s when required fields are missing", async () => {
    const res = await request(app).post("/customers").set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it("lists customers, including one just created, scoped to the caller's org", async () => {
    const created = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "List Me", email: "listme@example.com", country: "CA" });

    const res = await request(app).get("/customers").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.customers.map((c: { customer_id: string }) => c.customer_id);
    expect(ids).toContain(created.body.data.customer_id);
    expect(ids).toContain("cus_1001"); // seed customer, same org_default
  });

  // V4-3 (LLD_v4 §2): order history behind a customer, backing the new
  // TicketView order-history section (W13).
  it("lists a multi-order customer's orders, newest first", async () => {
    const res = await request(app)
      .get("/customers/cus_1001/orders")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.orders.map((o: { order_id: string }) => o.order_id);
    expect(ids).toEqual(expect.arrayContaining(["ord_5001", "ord_5007", "ord_5008", "ord_5009"]));

    const placedDates = res.body.data.orders.map((o: { placed_at: string }) => new Date(o.placed_at).getTime());
    expect([...placedDates].sort((a: number, b: number) => b - a)).toEqual(placedDates);
  });

  it("returns an empty array for a customer with a single order", async () => {
    const res = await request(app)
      .get("/customers/cus_1006/orders")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.orders.map((o: { order_id: string }) => o.order_id)).toContain("ord_5006");
  });

  it("404s for a customer that doesn't exist in the caller's org", async () => {
    const res = await request(app)
      .get("/customers/cus_does_not_exist/orders")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/customers/cus_1001/orders");
    expect(res.status).toBe(401);
  });

  it("a newly created customer can immediately be used to create a ticket", async () => {
    const customer = await request(app)
      .post("/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ticket Customer", email: "ticketcust@example.com", country: "GB" });

    const ticket = await request(app)
      .post("/tickets")
      .set("Authorization", `Bearer ${token}`)
      .send({
        customer_id: customer.body.data.customer_id,
        channel: "email",
        subject: "Question",
        body: "Where is my order?",
      });
    expect(ticket.status).toBe(201);
    expect(ticket.body.data.customer_id).toBe(customer.body.data.customer_id);
  });
});
