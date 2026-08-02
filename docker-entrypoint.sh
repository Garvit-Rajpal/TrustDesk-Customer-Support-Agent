#!/bin/sh
# Runs before every container start.
#
# Migrations are safe to re-run unconditionally — node-pg-migrate skips
# whatever's already applied, purely additive, never touches existing rows.
#
# Seeding is deliberately NOT unconditional: upsertSeedTicket's
# ON CONFLICT DO UPDATE resets a seeded ticket's status/triage back to its
# pristine value on every run (see scripts/seedIfEmpty.ts's comment) — if
# this ran on every container restart, a live demo's progress (triaged,
# drafted, sent, resolved tickets) would silently reset the moment the
# container restarts for any reason. `seed:if-empty` only seeds a
# genuinely empty database, so this is safe on first boot AND safe on
# every subsequent restart.
set -e

echo "[trustdesk] applying migrations..."
npm run migrate

echo "[trustdesk] checking whether demo data needs seeding..."
npm run seed:if-empty

echo "[trustdesk] starting server..."
exec "$@"
