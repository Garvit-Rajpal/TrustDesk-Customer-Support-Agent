import type { ColumnDefinitions, MigrationBuilder } from "node-pg-migrate";

export const shorthands: ColumnDefinitions | undefined = undefined;

// V2-4 (LLD_v2 §1/§5, ADR-10): activates ticket_messages + the status
// machine. Backfill inserts one inbound message per existing ticket from
// tickets.body (created_at = ticket.created_at) and links existing drafts'
// message_id to it — tickets.body itself is left untouched (audit
// invariant, HLD invariant #8), only new code starts reading the thread.
export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    CREATE TABLE ticket_messages (
      message_id text PRIMARY KEY,
      ticket_id  text NOT NULL REFERENCES tickets,
      direction  text NOT NULL CHECK (direction IN ('inbound','outbound')),
      body       text NOT NULL,
      author     text NOT NULL,
      draft_id   text REFERENCES drafts,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE drafts ADD COLUMN message_id text REFERENCES ticket_messages;

    ALTER TABLE tickets ADD CONSTRAINT tickets_status_check CHECK (status IN
      ('open','in_progress','awaiting_customer','customer_replied','resolved','closed'));

    INSERT INTO ticket_messages (message_id, ticket_id, direction, body, author, created_at)
    SELECT 'msg_seed_' || ticket_id, ticket_id, 'inbound', body, 'customer', created_at
    FROM tickets;

    UPDATE drafts d SET message_id = tm.message_id
    FROM ticket_messages tm
    WHERE tm.ticket_id = d.ticket_id AND tm.direction = 'inbound';
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(`
    ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
    ALTER TABLE drafts DROP COLUMN IF EXISTS message_id;
    DROP TABLE IF EXISTS ticket_messages;
  `);
}
