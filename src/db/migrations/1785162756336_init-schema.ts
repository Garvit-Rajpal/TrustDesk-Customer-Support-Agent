import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// DDL copied verbatim from LLD §2 — schema decisions are already made,
// this migration just materializes them.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE users (
      user_id       text PRIMARY KEY,
      username      text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      display_name  text NOT NULL,
      role          text NOT NULL DEFAULT 'agent'
                    CHECK (role IN ('agent','manager','admin')),
      created_at    timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE customers (
      customer_id text PRIMARY KEY,
      name        text NOT NULL,
      email       text NOT NULL,
      tier        text NOT NULL,
      country     text NOT NULL,
      verified    boolean NOT NULL,
      tags        jsonb NOT NULL DEFAULT '[]',
      created_at  timestamptz NOT NULL
    );

    CREATE TABLE orders (
      order_id              text PRIMARY KEY,
      customer_id           text NOT NULL REFERENCES customers,
      status                text NOT NULL,
      placed_at             timestamptz NOT NULL,
      delivered_at          timestamptz,
      eligible_return_until timestamptz,
      total                 numeric(12,2) NOT NULL,
      currency              text NOT NULL,
      payment_status        text NOT NULL,
      tracking_number       text,
      items                 jsonb NOT NULL
    );

    CREATE TABLE tickets (
      ticket_id   text PRIMARY KEY,
      customer_id text NOT NULL REFERENCES customers,
      order_id    text REFERENCES orders,
      channel     text NOT NULL,
      subject     text NOT NULL,
      body        text NOT NULL,
      status      text NOT NULL DEFAULT 'open',
      created_at  timestamptz NOT NULL,
      triage      jsonb
    );

    -- Seed-only labels, physically separated so runtime code cannot join them
    -- by accident (HLD invariant #4 / LLD §2).
    CREATE TABLE ticket_expected_labels (
      ticket_id           text PRIMARY KEY REFERENCES tickets,
      expected_category   text,
      expected_priority   text,
      expected_sentiment  text,
      expected_escalation boolean,
      expected_actions    jsonb
    );

    CREATE TABLE kb_documents (
      doc_id      text PRIMARY KEY,
      title       text NOT NULL,
      content     text NOT NULL,
      source_path text NOT NULL,
      version     text NOT NULL,
      audience    text NOT NULL,
      checksum    text NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now(),
      tsv         tsvector GENERATED ALWAYS AS
                  (setweight(to_tsvector('english', title), 'A') ||
                   setweight(to_tsvector('english', content), 'B')) STORED
    );
    CREATE INDEX kb_documents_tsv_idx ON kb_documents USING GIN (tsv);

    CREATE TABLE tool_catalog (
      tool_name               text PRIMARY KEY,
      description             text NOT NULL,
      risk_level               text NOT NULL,
      requires_human_approval boolean NOT NULL,
      allowed_categories      jsonb NOT NULL,
      required_fields         jsonb NOT NULL,
      max_amount_inr          integer
    );

    CREATE TABLE drafts (
      draft_id        text PRIMARY KEY,
      ticket_id       text NOT NULL REFERENCES tickets,
      run_id          text NOT NULL,
      status          text NOT NULL DEFAULT 'generated'
                      CHECK (status IN ('generated','edited','approved','rejected','sent')),
      resolution_type text NOT NULL CHECK (resolution_type IN ('answered','refused_by_policy','escalated')),
      body            text NOT NULL,
      citations       jsonb NOT NULL,
      recommended_actions jsonb NOT NULL DEFAULT '[]',
      created_at      timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE tool_actions (
      action_id       text PRIMARY KEY,
      ticket_id       text NOT NULL REFERENCES tickets,
      tool_name       text NOT NULL REFERENCES tool_catalog,
      payload         jsonb NOT NULL,
      risk_level      text NOT NULL,
      requires_human_approval boolean NOT NULL,
      status          text NOT NULL CHECK (status IN ('requested','approval_required','approved','rejected','executed','failed','cancelled')),
      idempotency_key text UNIQUE NOT NULL,
      execution_result jsonb,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE approvals (
      approval_id text PRIMARY KEY,
      action_id   text REFERENCES tool_actions,
      draft_id    text REFERENCES drafts,
      reviewer_id text NOT NULL REFERENCES users,
      decision    text NOT NULL CHECK (decision IN ('approved','rejected','needs_changes')),
      reason      text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      CHECK ((action_id IS NULL) <> (draft_id IS NULL))
    );

    CREATE TABLE agent_runs (
      run_id            text PRIMARY KEY,
      ticket_id         text REFERENCES tickets,
      run_type          text NOT NULL CHECK (run_type IN ('triage','draft_reply','tool_recommendation','eval_case')),
      status            text NOT NULL CHECK (status IN ('completed','guardrail_blocked','failed')),
      retrieved_doc_ids jsonb NOT NULL DEFAULT '[]',
      tool_calls        jsonb NOT NULL DEFAULT '[]',
      guardrail_results jsonb NOT NULL,
      rejected_output   jsonb,
      model_provider    text,
      model_name        text,
      latency_ms        integer,
      created_at        timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE eval_runs (
      eval_run_id  text PRIMARY KEY,
      started_at   timestamptz NOT NULL,
      completed_at timestamptz,
      total_cases  integer NOT NULL,
      metrics      jsonb,
      case_results jsonb
    );

    -- Designed now, built in Good To Have phase (HLD §8).
    CREATE TABLE feedback (
      feedback_id text PRIMARY KEY,
      ticket_id   text REFERENCES tickets,
      draft_id    text REFERENCES drafts,
      rating      integer,
      reason      text,
      corrected_response text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    DROP TABLE IF EXISTS feedback;
    DROP TABLE IF EXISTS eval_runs;
    DROP TABLE IF EXISTS agent_runs;
    DROP TABLE IF EXISTS approvals;
    DROP TABLE IF EXISTS tool_actions;
    DROP TABLE IF EXISTS drafts;
    DROP TABLE IF EXISTS tool_catalog;
    DROP TABLE IF EXISTS kb_documents;
    DROP TABLE IF EXISTS ticket_expected_labels;
    DROP TABLE IF EXISTS tickets;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS customers;
    DROP TABLE IF EXISTS users;
  `);
}
