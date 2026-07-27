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
