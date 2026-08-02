// Used by docker-entrypoint.sh on every container start. `npm run seed`
// itself is safe to re-run (upserts by ID, no duplicates — see
// tests/integration/seedIntegrity.test.ts) but it's NOT a no-op: seeded
// tickets' `status`/`triage` columns get overwritten back to their
// pristine seed values on every run (upsertSeedTicket's ON CONFLICT DO
// UPDATE includes status/triage). Auto-seeding on every restart would
// silently wipe a live demo's progress (triaged/sent/resolved tickets all
// reset to "open") the moment the container restarts for any reason. This
// only seeds a genuinely empty database — first boot only, never again
// after that, regardless of how many times the container restarts.
import "dotenv/config";
import { pool } from "../src/db/pool.js";
import { runSeed } from "../src/db/seed.js";

async function main(): Promise<void> {
  const { rows } = await pool.query("SELECT count(*)::int AS count FROM tickets");
  const alreadySeeded = (rows[0]?.count ?? 0) > 0;

  if (alreadySeeded) {
    console.log("[trustdesk] tickets table is non-empty — skipping seed (already initialized).");
  } else {
    console.log("[trustdesk] empty database detected — seeding demo data...");
    const summary = await runSeed();
    console.log("[trustdesk] seed complete:", summary);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
