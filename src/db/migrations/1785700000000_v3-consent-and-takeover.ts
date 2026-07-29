import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V3-2 (LLD_v3 §1). Unlike v2's org_id backfill, every column here has a
// historically-correct default for all existing rows (no consent granted,
// no ticket human-owned, no welcome banner seen) — plain
// nullable/DEFAULT-false additions, no backfill-then-NOT-NULL dance needed.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE orgs ADD COLUMN allow_platform_support boolean NOT NULL DEFAULT false;
    ALTER TABLE orgs ADD COLUMN allow_platform_metrics boolean NOT NULL DEFAULT false;

    ALTER TABLE users ADD COLUMN welcome_seen_at timestamptz;

    ALTER TABLE tickets ADD COLUMN human_owned boolean NOT NULL DEFAULT false;
    ALTER TABLE tickets ADD COLUMN human_owned_by text REFERENCES users;
    ALTER TABLE tickets ADD COLUMN human_owned_at timestamptz;

    CREATE INDEX ON orgs (allow_platform_support) WHERE allow_platform_support;
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE tickets DROP COLUMN IF EXISTS human_owned_at;
    ALTER TABLE tickets DROP COLUMN IF EXISTS human_owned_by;
    ALTER TABLE tickets DROP COLUMN IF EXISTS human_owned;
    ALTER TABLE users DROP COLUMN IF EXISTS welcome_seen_at;
    ALTER TABLE orgs DROP COLUMN IF EXISTS allow_platform_metrics;
    ALTER TABLE orgs DROP COLUMN IF EXISTS allow_platform_support;
  `);
}
