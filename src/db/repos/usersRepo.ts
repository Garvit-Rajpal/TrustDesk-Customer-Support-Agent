import { pool } from "../pool.js";

export interface UserRow {
  user_id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: string;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query(
    `SELECT user_id, username, password_hash, display_name, role
     FROM users WHERE username = $1`,
    [username]
  );
  return rows[0] ?? null;
}

// V2-2 (LLD_v2 §3, ADR-9): POST /users/invite's write path — a real INSERT,
// not upsertUser's seed-only ON CONFLICT upsert. Unique-violation on
// username is left to the caller (route maps it to 409 CONFLICT).
export async function insertUser(user: UserRow): Promise<void> {
  await pool.query(
    `INSERT INTO users (user_id, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.user_id, user.username, user.password_hash, user.display_name, user.role]
  );
}

export async function upsertUser(user: UserRow): Promise<void> {
  await pool.query(
    `INSERT INTO users (user_id, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name,
       role = EXCLUDED.role`,
    [user.user_id, user.username, user.password_hash, user.display_name, user.role]
  );
}
