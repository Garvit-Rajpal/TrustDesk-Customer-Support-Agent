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

export async function listKbDocuments(): Promise<KbDocumentRow[]> {
  const { rows } = await pool.query(
    `SELECT doc_id, title, content, source_path, version, audience
     FROM kb_documents ORDER BY doc_id`
  );
  return rows;
}

export interface SearchResultRow {
  doc_id: string;
  title: string;
  audience: string;
  snippet: string;
  score: number;
}

// FTS via websearch_to_tsquery + ts_rank (LLD §4.3). Retrieval does NOT
// filter by audience — internal docs may be retrieved and cited (HLD §5
// audience nuance); the restriction is on quoting them in the draft body,
// enforced later by the L3 output guardrail.
//
// Category boost is additive to score, not folded into the WHERE match:
// websearch_to_tsquery ANDs bare words together, so appending the category
// into the same query would silently exclude docs that don't literally
// contain that word — the opposite of "boost" (LLD §4.3: "Optional category
// boost term"). Docs matching the category get a ranking bonus instead.
export async function searchKbDocuments(
  query: string,
  category?: string
): Promise<SearchResultRow[]> {
  const { rows } = await pool.query(
    `SELECT doc_id, title, audience,
            ts_rank(tsv, websearch_to_tsquery('english', $1))
              + CASE WHEN $2::text IS NOT NULL
                     THEN 0.2 * ts_rank(tsv, plainto_tsquery('english', $2))
                     ELSE 0 END AS score,
            ts_headline('english', content, websearch_to_tsquery('english', $1),
              'MaxFragments=1, MaxWords=35, MinWords=15') AS snippet
     FROM kb_documents
     WHERE tsv @@ websearch_to_tsquery('english', $1)
     ORDER BY score DESC
     LIMIT 5`,
    [query, category ?? null]
  );
  return rows;
}
