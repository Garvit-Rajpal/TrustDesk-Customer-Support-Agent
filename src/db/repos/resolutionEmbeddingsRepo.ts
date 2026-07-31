// resolutionEmbeddingsRepo (LLD_v4 §5, HLD_v4 ADR-21): past resolved-ticket
// embeddings, org-scoped like every repo function in this codebase — a
// similarity search never crosses an org boundary, same tenancy contract
// retrieval.ts's FTS search already enforces.
import { toSql } from "pgvector";
import { pool } from "../pool.js";
import type { OrgContext } from "../../domain/orgContext.js";

export interface NewResolutionEmbedding {
  embedding_id: string;
  ticket_id: string;
  draft_id: string;
  category: string;
  resolution_type: string;
  source_text: string;
  embedding: number[];
}

export async function insertResolutionEmbedding(ctx: OrgContext, row: NewResolutionEmbedding): Promise<void> {
  await pool.query(
    `INSERT INTO ticket_resolution_embeddings
       (embedding_id, org_id, ticket_id, draft_id, category, resolution_type, source_text, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.embedding_id,
      ctx.org_id,
      row.ticket_id,
      row.draft_id,
      row.category,
      row.resolution_type,
      row.source_text,
      toSql(row.embedding),
    ]
  );
}

export interface SimilarResolution {
  embedding_id: string;
  ticket_id: string;
  draft_id: string;
  category: string;
  resolution_type: string;
  source_text: string;
  distance: number;
}

// Cosine distance (`<=>`, pgvector's operator for vector_cosine_ops, the
// same op class the ivfflat index on this table was built with) — lower is
// more similar. `category` narrows the search when the caller already
// knows the current ticket's triage category (LLD_v4 §5).
export async function findSimilarResolutions(
  ctx: OrgContext,
  queryEmbedding: number[],
  category?: string,
  limit = 3
): Promise<SimilarResolution[]> {
  const conditions: string[] = ["org_id = $1"];
  const params: unknown[] = [ctx.org_id];

  params.push(toSql(queryEmbedding));
  const embeddingParam = params.length;

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  params.push(limit);
  const limitParam = params.length;

  const { rows } = await pool.query(
    `SELECT embedding_id, ticket_id, draft_id, category, resolution_type, source_text,
            embedding <=> $${embeddingParam} AS distance
     FROM ticket_resolution_embeddings
     WHERE ${conditions.join(" AND ")}
     ORDER BY embedding <=> $${embeddingParam}
     LIMIT $${limitParam}`,
    params
  );
  return rows.map((row) => ({ ...row, distance: Number(row.distance) }));
}
