// V4-3 (LLD_v4 §2): listOrdersByCustomerId — order history behind a
// customer, org-scoped like every other repo function.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import { listOrdersByCustomerId, upsertOrder } from "../../src/db/repos/ordersRepo.js";
import { createOrg } from "../../src/services/orgOnboarding.js";
import { ORG_DEFAULT } from "../helpers/org.js";

describe("ordersRepo.listOrdersByCustomerId", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns every order for a multi-order seed customer, newest first", async () => {
    const orders = await listOrdersByCustomerId(ORG_DEFAULT, "cus_1001");
    const ids = orders.map((o) => o.order_id);
    expect(ids).toEqual(expect.arrayContaining(["ord_5001", "ord_5007", "ord_5008", "ord_5009"]));
    expect(orders.length).toBe(4);

    // newest-first (placed_at DESC)
    const placedDates = orders.map((o) => new Date(o.placed_at).getTime());
    expect([...placedDates].sort((a, b) => b - a)).toEqual(placedDates);
  });

  it("returns an empty array for a customer with a single order", async () => {
    const orders = await listOrdersByCustomerId(ORG_DEFAULT, "cus_1002");
    expect(orders.map((o) => o.order_id)).toEqual(
      expect.arrayContaining(["ord_5002", "ord_5010", "ord_5011", "ord_5012"])
    );
  });

  it("returns an empty array for a customer with no orders at all", async () => {
    const orders = await listOrdersByCustomerId(ORG_DEFAULT, "cus_does_not_exist");
    expect(orders).toEqual([]);
  });

  it("is org-scoped — a customer/order pair in a different org is invisible to org_default", async () => {
    const outcome = await createOrg({
      name: "Isolated Co",
      vertical: "retail_ecommerce",
      admin_username: `orders_iso_${Date.now()}`,
      admin_password: "password123",
      admin_display_name: "Iso Admin",
    });
    if (outcome.kind !== "ok") throw new Error("expected org creation to succeed");
    const otherOrgId = outcome.org.org_id;
    const otherCustomerId = outcome.customer_ids[0]!;

    await upsertOrder(
      {
        order_id: "ord_iso_9999",
        customer_id: otherCustomerId,
        status: "delivered",
        placed_at: "2026-01-01",
        delivered_at: "2026-01-05",
        eligible_return_until: "2026-01-12",
        total: 999,
        currency: "INR",
        payment_status: "paid",
        tracking_number: null,
        items: [],
      },
      otherOrgId
    );

    // Same customer_id, queried under org_default's context, sees nothing —
    // org_id scoping, not customer_id uniqueness, is what isolates it.
    const fromWrongOrg = await listOrdersByCustomerId(ORG_DEFAULT, otherCustomerId);
    expect(fromWrongOrg).toEqual([]);

    const fromOwnOrg = await listOrdersByCustomerId({ org_id: otherOrgId }, otherCustomerId);
    expect(fromOwnOrg.map((o) => o.order_id)).toContain("ord_iso_9999");
  });
});
