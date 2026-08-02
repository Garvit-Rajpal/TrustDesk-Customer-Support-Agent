import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V5-17 (LLD_v5 §1/§6, HLD_v5 ADR-29): one row per issued magic link.
// token_hash (sha256 of the raw opaque token) is the only thing ever
// stored — the raw token itself lives only in the emailed URL, never in
// this table. Org-scoped like every other repo table in this codebase.
// consumed_at is the single-use marker: findValidMagicLinkByTokenHash()
// excludes both expired and already-consumed rows by construction.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE customer_magic_links (
      link_id       text PRIMARY KEY,
      org_id        text NOT NULL REFERENCES orgs,
      customer_id   text NOT NULL REFERENCES customers,
      ticket_id     text REFERENCES tickets,
      token_hash    text NOT NULL,
      expires_at    timestamptz NOT NULL,
      consumed_at   timestamptz,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX ON customer_magic_links (token_hash);
    CREATE INDEX ON customer_magic_links (customer_id, created_at);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`DROP TABLE IF EXISTS customer_magic_links;`);
}
