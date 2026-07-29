import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V2-5 (LLD_v2 §1/§6): orgs table + org_id backfill. Nullable-then-backfill-
// then-NOT-NULL on every org-scoped table, all landing on 'org_default' so
// every v1 seed row (and every existing test fixture) keeps working
// unchanged. kb_documents.doc_id stays globally unique — org isolation for
// documents comes from the org_id filter, not from the ID shape; only
// pack-stamped docs (V2-5 POST /orgs) get an '{ORG}-' prefix.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE orgs (
      org_id     text PRIMARY KEY,
      name       text NOT NULL,
      vertical   text NOT NULL CHECK (vertical IN ('retail_ecommerce','software','finance')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO orgs (org_id, name, vertical) VALUES ('org_default', 'Default Org', 'retail_ecommerce');

    ALTER TABLE users ADD COLUMN org_id text REFERENCES orgs;
    UPDATE users SET org_id = 'org_default';
    ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE customers ADD COLUMN org_id text REFERENCES orgs;
    UPDATE customers SET org_id = 'org_default';
    ALTER TABLE customers ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE orders ADD COLUMN org_id text REFERENCES orgs;
    UPDATE orders SET org_id = 'org_default';
    ALTER TABLE orders ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE tickets ADD COLUMN org_id text REFERENCES orgs;
    UPDATE tickets SET org_id = 'org_default';
    ALTER TABLE tickets ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE kb_documents ADD COLUMN org_id text REFERENCES orgs;
    UPDATE kb_documents SET org_id = 'org_default';
    ALTER TABLE kb_documents ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE drafts ADD COLUMN org_id text REFERENCES orgs;
    UPDATE drafts SET org_id = 'org_default';
    ALTER TABLE drafts ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE tool_actions ADD COLUMN org_id text REFERENCES orgs;
    UPDATE tool_actions SET org_id = 'org_default';
    ALTER TABLE tool_actions ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE approvals ADD COLUMN org_id text REFERENCES orgs;
    UPDATE approvals SET org_id = 'org_default';
    ALTER TABLE approvals ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE agent_runs ADD COLUMN org_id text REFERENCES orgs;
    UPDATE agent_runs SET org_id = 'org_default';
    ALTER TABLE agent_runs ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE eval_runs ADD COLUMN org_id text REFERENCES orgs;
    UPDATE eval_runs SET org_id = 'org_default';
    ALTER TABLE eval_runs ALTER COLUMN org_id SET NOT NULL;

    ALTER TABLE feedback ADD COLUMN org_id text REFERENCES orgs;
    UPDATE feedback SET org_id = 'org_default';
    ALTER TABLE feedback ALTER COLUMN org_id SET NOT NULL;

    CREATE INDEX ON tickets (org_id, status);
    CREATE INDEX ON kb_documents (org_id);
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE feedback DROP COLUMN IF EXISTS org_id;
    ALTER TABLE eval_runs DROP COLUMN IF EXISTS org_id;
    ALTER TABLE agent_runs DROP COLUMN IF EXISTS org_id;
    ALTER TABLE approvals DROP COLUMN IF EXISTS org_id;
    ALTER TABLE tool_actions DROP COLUMN IF EXISTS org_id;
    ALTER TABLE drafts DROP COLUMN IF EXISTS org_id;
    ALTER TABLE kb_documents DROP COLUMN IF EXISTS org_id;
    ALTER TABLE tickets DROP COLUMN IF EXISTS org_id;
    ALTER TABLE orders DROP COLUMN IF EXISTS org_id;
    ALTER TABLE customers DROP COLUMN IF EXISTS org_id;
    ALTER TABLE users DROP COLUMN IF EXISTS org_id;
    DROP TABLE IF EXISTS orgs;
  `);
}
