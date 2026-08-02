// RetrievalService (HLD ADR-2 / §3): interface-first seam so the FTS engine
// can be swapped for Elasticsearch/pgvector later without touching callers.
import { searchKbDocuments } from "../db/repos/kbDocumentsRepo.js";
import { findSimilarResolutions } from "../db/repos/resolutionEmbeddingsRepo.js";
import type { OrgContext } from "../domain/orgContext.js";
import type { EmbeddingAdapter } from "../adapters/embeddingAdapter.js";

export interface RetrievedDocument {
  doc_id: string;
  title: string;
  snippet: string;
  score: number;
  audience: string;
}

export async function searchDocuments(
  ctx: OrgContext,
  query: string,
  category?: string
): Promise<RetrievedDocument[]> {
  const rows = await searchKbDocuments(ctx, query, category);
  return rows.map((r) => ({
    doc_id: r.doc_id,
    title: r.title,
    snippet: r.snippet,
    score: r.score,
    audience: r.audience,
  }));
}

// websearch_to_tsquery ANDs bare words together (kbDocumentsRepo.ts) — right
// for a short admin-typed query via GET /documents/search?q=, wrong for a
// full multi-sentence ticket body: no single doc contains every word in it,
// so an AND query over the whole ticket matches nothing. Callers that derive
// their query from a long free-text document (DraftService, and later the
// EvalRunner) should build their query text with this instead, which turns
// it into an OR query so ranking — not membership — does the filtering.
export function buildBroadQueryText(text: string): string {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const unique = Array.from(new Set(words)).filter((w) => w.length > 2);
  return unique.join(" or ");
}

// RAG-pipeline visibility: what generateDraft() actually retrieved and fed
// into a given draft's prompt as similarity context — persisted onto that
// draft's agent_runs row (migration 1786100000000) so it's visible via
// TracePanel/the audit trail, not just used in-memory and discarded.
export interface SimilarResolutionMatch {
  embedding_id: string;
  ticket_id: string;
  distance: number;
  source_text: string;
}

// V4-13 (LLD_v4 §5, HLD_v4 ADR-21): additive to the FTS search above, not a
// replacement — past resolutions grounded in real, previously sent replies.
// Informational context for the draft prompt, never a citable source
// (outputScan.ts's checkCitationSubset only ever accepts a doc_id from
// ctx.retrievedDocIds, so a model "citing" a ticket_id here is already
// rejected by existing code, unchanged).
export async function searchSimilarResolutions(
  ctx: OrgContext,
  embeddingAdapter: EmbeddingAdapter,
  queryText: string,
  category?: string,
  limit = 3
): Promise<SimilarResolutionMatch[]> {
  const queryEmbedding = await embeddingAdapter.embed(queryText);
  const results = await findSimilarResolutions(ctx, queryEmbedding, category, limit);
  return results.map((r) => ({
    embedding_id: r.embedding_id,
    ticket_id: r.ticket_id,
    distance: r.distance,
    source_text: r.source_text,
  }));
}
