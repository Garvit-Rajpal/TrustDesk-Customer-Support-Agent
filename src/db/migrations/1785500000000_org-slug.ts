import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V2-5 follow-up: orgs.slug is a human-readable, unique, name-derived
// identifier used to prefix a stamped policy pack's doc IDs
// ('{SLUG}-KB-REFUND-001') instead of the opaque org_id nanoid — much more
// legible in the documents list. org_default's slug is 'DEFAULT'; it's
// never actually used as a prefix (org_default keeps its unprefixed v1 doc
// IDs) but every org gets a slug for display/consistency.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE orgs ADD COLUMN slug text;
    UPDATE orgs SET slug = 'DEFAULT' WHERE org_id = 'org_default';
    -- Backfill any orgs created before this migration (e.g. via the app
    -- during V2-5 dev/testing, before slugs existed): derive a slug from
    -- the name the same way the app does, disambiguating on a collision
    -- with a row-number suffix so the UNIQUE constraint below never fails.
    WITH derived AS (
      SELECT org_id,
             NULLIF(regexp_replace(upper(name), '[^A-Z0-9]+', '-', 'g'), '') AS base_slug,
             row_number() OVER (
               PARTITION BY regexp_replace(upper(name), '[^A-Z0-9]+', '-', 'g')
               ORDER BY created_at
             ) AS rn
      FROM orgs
      WHERE slug IS NULL
    )
    UPDATE orgs o
    SET slug = CASE WHEN derived.rn = 1 THEN COALESCE(derived.base_slug, 'ORG')
                     ELSE COALESCE(derived.base_slug, 'ORG') || '-' || derived.rn END
    FROM derived
    WHERE o.org_id = derived.org_id;

    ALTER TABLE orgs ALTER COLUMN slug SET NOT NULL;
    ALTER TABLE orgs ADD CONSTRAINT orgs_slug_unique UNIQUE (slug);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE orgs DROP CONSTRAINT IF EXISTS orgs_slug_unique;
    ALTER TABLE orgs DROP COLUMN IF EXISTS slug;
  `);
}
