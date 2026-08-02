// customerMagicLinksRepo (LLD_v5 §6, HLD_v5 ADR-29): org-scoped like every
// other repo table in this codebase.
import { pool } from "../pool.js";
import type { OrgContext } from "../../domain/orgContext.js";

export interface NewMagicLink {
  link_id: string;
  customer_id: string;
  ticket_id?: string;
  token_hash: string;
  expires_at: Date;
}

export async function insertMagicLink(ctx: OrgContext, row: NewMagicLink): Promise<void> {
  await pool.query(
    `INSERT INTO customer_magic_links (link_id, org_id, customer_id, ticket_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.link_id, ctx.org_id, row.customer_id, row.ticket_id ?? null, row.token_hash, row.expires_at]
  );
}

export interface MagicLinkRow {
  link_id: string;
  org_id: string;
  customer_id: string;
  ticket_id: string | null;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
}

// Excludes both expired and already-consumed rows by construction, so a
// caller never has to separately check either condition — a lookup miss
// here covers "never existed," "expired," and "already consumed" alike.
export async function findValidMagicLinkByTokenHash(tokenHash: string): Promise<MagicLinkRow | null> {
  const { rows } = await pool.query(
    `SELECT link_id, org_id, customer_id, ticket_id, token_hash, expires_at::text, consumed_at::text
     FROM customer_magic_links
     WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

// The `AND consumed_at IS NULL` guard makes a race between two
// near-simultaneous consume attempts resolve to exactly one winner at the
// DB level, not just at the application-logic level — the caller checks
// rowCount to tell which attempt won.
export async function markMagicLinkConsumed(linkId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE customer_magic_links SET consumed_at = now() WHERE link_id = $1 AND consumed_at IS NULL`,
    [linkId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Feeds the per-customer anti-abuse guard in POST /magic-link/request —
// counts links issued to this customer in the last `sinceMinutesAgo`
// minutes, regardless of whether they've since been consumed or expired.
export async function countRecentLinksForCustomer(customerId: string, sinceMinutesAgo: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM customer_magic_links
     WHERE customer_id = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
    [customerId, sinceMinutesAgo]
  );
  return rows[0].count;
}
