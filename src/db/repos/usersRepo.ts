import { pool } from "../pool.js";
import type { OrgContext } from "../../domain/orgContext.js";

export interface UserRow {
  user_id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
  org_id: string;
  welcome_seen_at?: string | null;
}

// Not org-scoped by ctx: login (POST /auth/login) happens before any JWT
// exists, so there is no OrgContext yet to scope by — usernames are unique
// globally (LLD_v2 §6: "login response includes org", not "select an org
// first"), and org_id on the returned row is what seeds the JWT's org claim.
export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query(
    `SELECT user_id, username, password_hash, display_name, role, org_id, welcome_seen_at::text
     FROM users WHERE username = $1`,
    [username]
  );
  return rows[0] ?? null;
}

// V3-7 (LLD_v3 §5): set-once — POST /users/me/welcome-seen. Idempotent by
// construction (re-running just re-sets the same "now").
export async function markWelcomeSeen(ctx: OrgContext, userId: string): Promise<string> {
  const { rows } = await pool.query(
    `UPDATE users SET welcome_seen_at = now() WHERE user_id = $1 AND org_id = $2
     RETURNING welcome_seen_at::text`,
    [userId, ctx.org_id]
  );
  return rows[0].welcome_seen_at;
}

// V2-2 (LLD_v2 §3, ADR-9): POST /users/invite's write path — a real INSERT,
// not upsertUser's seed-only ON CONFLICT upsert. Unique-violation on
// username is left to the caller (route maps it to 409 CONFLICT).
// V2-5 (LLD_v2 §6): "invited user lands in the inviter's org" — ctx.org_id
// is the inviter's org, threaded in by the route from req.orgContext.
export async function insertUser(ctx: OrgContext, user: Omit<UserRow, "org_id">): Promise<void> {
  await pool.query(
    `INSERT INTO users (user_id, username, password_hash, display_name, role, org_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.user_id, user.username, user.password_hash, user.display_name, user.role, ctx.org_id]
  );
}

// Seed-loader only. Takes org_id explicitly (not OrgContext) because the
// seed loader also creates org_default itself — there's no ambient context
// to lift it from yet.
export async function upsertUser(user: UserRow): Promise<void> {
  await pool.query(
    `INSERT INTO users (user_id, username, password_hash, display_name, role, org_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name,
       role = EXCLUDED.role, org_id = EXCLUDED.org_id`,
    [user.user_id, user.username, user.password_hash, user.display_name, user.role, user.org_id]
  );
}
