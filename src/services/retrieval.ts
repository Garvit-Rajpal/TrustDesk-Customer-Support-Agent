// RetrievalService (HLD ADR-2 / §3): interface-first seam so the FTS engine
// can be swapped for Elasticsearch/pgvector later without touching callers.
import { searchKbDocuments } from "../db/repos/kbDocumentsRepo.js";

export interface RetrievedDocument {
  doc_id: string;
  title: string;
  snippet: string;
  score: number;
  audience: string;
}

export async function searchDocuments(
  query: string,
  category?: string
): Promise<RetrievedDocument[]> {
  const rows = await searchKbDocuments(query, category);
  return rows.map((r) => ({
    doc_id: r.doc_id,
    title: r.title,
    snippet: r.snippet,
    score: r.score,
    audience: r.audience,
  }));
}
