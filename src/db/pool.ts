import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function truncateAll(): Promise<void> {
  // Order matters for FK-referencing tables; CASCADE keeps it simple for tests.
  await pool.query(`
    TRUNCATE TABLE
      run_events, feedback, eval_runs, agent_runs, approvals, tool_actions, drafts,
      tool_catalog, kb_documents, ticket_expected_labels, tickets,
      orders, customers, users
    RESTART IDENTITY CASCADE
  `);
}
