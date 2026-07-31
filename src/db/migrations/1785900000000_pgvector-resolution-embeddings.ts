import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V4-9 (LLD_v4 §1/§5, HLD_v4 ADR-21): similarity ingestion — one row per
// (org, ticket, sent draft) resolution actually embedded. Org-scoped like
// every other repo table (org_id first-class, not derived). ivfflat/cosine
// index — this codebase's retrieval.ts has anticipated this exact swap
// since v1 ("interface-first seam so the FTS engine can be swapped for
// Elasticsearch/pgvector later without touching callers").
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE ticket_resolution_embeddings (
      embedding_id    text PRIMARY KEY,
      org_id          text NOT NULL REFERENCES orgs,
      ticket_id       text NOT NULL,
      draft_id        text NOT NULL,
      category        text NOT NULL,
      resolution_type text NOT NULL,
      source_text     text NOT NULL,
      embedding       vector(768) NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX ON ticket_resolution_embeddings (org_id);
    CREATE INDEX ON ticket_resolution_embeddings
      USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS ticket_resolution_embeddings;
    DROP EXTENSION IF EXISTS vector;
  `);
}
