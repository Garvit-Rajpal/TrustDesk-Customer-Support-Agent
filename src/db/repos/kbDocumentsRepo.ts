import { createHash } from "node:crypto";
import { pool } from "../pool.js";
import { KbDocumentInput } from "../../domain/entities.js";

function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Upsert by doc_id, skip write when checksum unchanged (LLD §4.2: "Upsert by
// doc_id when checksum differs"). Returns true if a row was written.
export async function upsertKbDocument(doc: KbDocumentInput): Promise<boolean> {
  const sum = checksum(doc.content);
  const { rows: existing } = await pool.query(
    `SELECT checksum FROM kb_documents WHERE doc_id = $1`,
    [doc.doc_id]
  );
  if (existing.length > 0 && existing[0].checksum === sum) {
    return false;
  }

  await pool.query(
    `INSERT INTO kb_documents (doc_id, title, content, source_path, version, audience, checksum)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (doc_id) DO UPDATE SET
       title = EXCLUDED.title, content = EXCLUDED.content, source_path = EXCLUDED.source_path,
       version = EXCLUDED.version, audience = EXCLUDED.audience, checksum = EXCLUDED.checksum,
       updated_at = now()`,
    [doc.doc_id, doc.title, doc.content, doc.source_path, doc.version, doc.audience, sum]
  );
  return true;
}

export interface KbDocumentRow {
  doc_id: string;
  title: string;
  content: string;
  source_path: string;
  version: string;
  audience: string;
}

export async function getKbDocumentById(docId: string): Promise<KbDocumentRow | null> {
  const { rows } = await pool.query(
    `SELECT doc_id, title, content, source_path, version, audience
     FROM kb_documents WHERE doc_id = $1`,
    [docId]
  );
  return rows[0] ?? null;
}
