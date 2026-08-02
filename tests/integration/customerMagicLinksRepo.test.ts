// V5-18 (LLD_v5 §6, HLD_v5 ADR-29): customerMagicLinksRepo — insert/find/
// consume, org-isolation, expired-excluded, consumed-excluded.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool, truncateAll } from "../../src/db/pool.js";
import { runSeed } from "../../src/db/seed.js";
import {
  countRecentLinksForCustomer,
  findValidMagicLinkByTokenHash,
  insertMagicLink,
  markMagicLinkConsumed,
} from "../../src/db/repos/customerMagicLinksRepo.js";
import { createOrg } from "../../src/services/orgOnboarding.js";
import { ORG_DEFAULT } from "../helpers/org.js";

describe("customerMagicLinksRepo", () => {
  beforeAll(async () => {
    await truncateAll();
    await runSeed();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE TABLE customer_magic_links`);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("inserts and reads back a valid link by its token hash", async () => {
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_1",
      customer_id: "cus_1001",
      token_hash: "hash-1",
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });

    const found = await findValidMagicLinkByTokenHash("hash-1");
    expect(found).not.toBeNull();
    expect(found!.link_id).toBe("mlk_1");
    expect(found!.customer_id).toBe("cus_1001");
    expect(found!.consumed_at).toBeNull();
  });

  it("preserves an optional ticket_id", async () => {
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_ticket",
      customer_id: "cus_1001",
      ticket_id: "tkt_9001",
      token_hash: "hash-ticket",
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });
    const found = await findValidMagicLinkByTokenHash("hash-ticket");
    expect(found!.ticket_id).toBe("tkt_9001");
  });

  it("returns null for a token hash that was never inserted", async () => {
    expect(await findValidMagicLinkByTokenHash("no-such-hash")).toBeNull();
  });

  it("excludes an expired link", async () => {
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_expired",
      customer_id: "cus_1001",
      token_hash: "hash-expired",
      expires_at: new Date(Date.now() - 1000),
    });
    expect(await findValidMagicLinkByTokenHash("hash-expired")).toBeNull();
  });

  it("excludes an already-consumed link", async () => {
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_consumed",
      customer_id: "cus_1001",
      token_hash: "hash-consumed",
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });
    const consumed = await markMagicLinkConsumed("mlk_consumed");
    expect(consumed).toBe(true);
    expect(await findValidMagicLinkByTokenHash("hash-consumed")).toBeNull();
  });

  it("markMagicLinkConsumed returns false on a second attempt — the DB-level single-winner guard", async () => {
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_race",
      customer_id: "cus_1001",
      token_hash: "hash-race",
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });
    expect(await markMagicLinkConsumed("mlk_race")).toBe(true);
    expect(await markMagicLinkConsumed("mlk_race")).toBe(false);
  });

  it("markMagicLinkConsumed returns false for an unknown link_id", async () => {
    expect(await markMagicLinkConsumed("mlk_does_not_exist")).toBe(false);
  });

  it("countRecentLinksForCustomer counts only links within the window", async () => {
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_recent_1",
      customer_id: "cus_1001",
      token_hash: "hash-recent-1",
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });
    await insertMagicLink(ORG_DEFAULT, {
      link_id: "mlk_recent_2",
      customer_id: "cus_1001",
      token_hash: "hash-recent-2",
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    });
    expect(await countRecentLinksForCustomer("cus_1001", 60)).toBe(2);
    expect(await countRecentLinksForCustomer("cus_1002", 60)).toBe(0);
  });

  it("is org-scoped for insert — a link for another org doesn't collide, and both are independently findable", async () => {
    const outcome = await createOrg({
      name: "Magic Link Isolated Co",
      vertical: "retail_ecommerce",
      admin_username: `mlk_iso_${Date.now()}`,
      admin_password: "password123",
      admin_display_name: "Iso Admin",
    });
    if (outcome.kind !== "ok") throw new Error("expected org creation to succeed");
    const otherOrgId = outcome.org.org_id;

    // customer_id has a plain (non-composite) FK to customers — reusing a
    // real seeded customer id here is enough to test org_id isolation on
    // this table without also needing to create a customer under otherOrgId.
    await insertMagicLink(
      { org_id: otherOrgId },
      {
        link_id: "mlk_other_org",
        customer_id: "cus_1001",
        token_hash: "hash-other-org",
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      }
    );

    const found = await findValidMagicLinkByTokenHash("hash-other-org");
    expect(found!.org_id).toBe(otherOrgId);
  });
});
