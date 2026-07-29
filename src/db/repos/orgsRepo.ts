import { pool } from "../pool.js";
import { Org } from "../../domain/entities.js";
import type { Vertical } from "../../domain/schemas.js";

// Not org-scoped by OrgContext (there's nothing to scope by yet — this is
// the table OrgContext.org_id points into). insertOrg is the one write path
// that creates a brand-new tenant rather than operating within an existing one.
export async function insertOrg(org: {
  org_id: string;
  name: string;
  slug: string;
  vertical: Vertical;
}): Promise<Org> {
  const { rows } = await pool.query(
    `INSERT INTO orgs (org_id, name, slug, vertical) VALUES ($1, $2, $3, $4)
     RETURNING org_id, name, slug, vertical, created_at::text`,
    [org.org_id, org.name, org.slug, org.vertical]
  );
  return Org.parse(rows[0]);
}

// Seed-loader only: org_default must exist before any seed row referencing
// it is written, and truncateAll() wipes orgs along with everything else
// each test's beforeAll, so this needs to be idempotent like every other
// seed upsert.
export async function upsertSeedOrg(org: {
  org_id: string;
  name: string;
  slug: string;
  vertical: Vertical;
}): Promise<void> {
  await pool.query(
    `INSERT INTO orgs (org_id, name, slug, vertical) VALUES ($1, $2, $3, $4)
     ON CONFLICT (org_id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug,
       vertical = EXCLUDED.vertical`,
    [org.org_id, org.name, org.slug, org.vertical]
  );
}

export async function getOrgById(orgId: string): Promise<Org | null> {
  const { rows } = await pool.query(
    `SELECT org_id, name, slug, vertical, created_at::text FROM orgs WHERE org_id = $1`,
    [orgId]
  );
  if (rows.length === 0) return null;
  return Org.parse(rows[0]);
}

// Onboarding uses this to pick a free slug (see orgOnboarding.ts's
// deriveUniqueSlug) — a plain existence check, not a full row fetch.
export async function slugExists(slug: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM orgs WHERE slug = $1`, [slug]);
  return rows.length > 0;
}
