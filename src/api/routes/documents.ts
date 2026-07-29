import { Router } from "express";
import { IngestRequest } from "../../domain/documentTypes.js";
import { upsertKbDocument, getKbDocumentById, listKbDocuments } from "../../db/repos/kbDocumentsRepo.js";
import { searchDocuments } from "../../services/retrieval.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const documentsRouter = Router();

// LLD §4.2: upsert by doc_id when checksum differs; re-runnable.
documentsRouter.post("/ingest", requirePermission("documents:ingest"), async (req, res, next) => {
  try {
    const parsed = IngestRequest.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, "VALIDATION_ERROR", "documents[] is required", parsed.error.flatten());
      return;
    }

    let ingested = 0;
    const document_ids: string[] = [];
    for (const doc of parsed.data.documents) {
      const wrote = await upsertKbDocument(doc);
      if (wrote) ingested += 1;
      document_ids.push(doc.doc_id);
    }

    res.status(200).json({ data: { ingested, document_ids } });
  } catch (err) {
    next(err);
  }
});

// LLD §4.3: FTS via websearch_to_tsquery, ts_rank ordering, top 5.
documentsRouter.get("/search", requirePermission("documents:view"), async (req, res, next) => {
  try {
    const q = req.query.q;
    if (typeof q !== "string" || q.trim().length === 0) {
      sendError(res, "VALIDATION_ERROR", "q query parameter is required");
      return;
    }
    const category = typeof req.query.category === "string" ? req.query.category : undefined;

    const results = await searchDocuments(q, category);
    res.status(200).json({ data: { query: q, results } });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/", requirePermission("documents:view"), async (_req, res, next) => {
  try {
    const documents = await listKbDocuments();
    res.status(200).json({ data: { documents } });
  } catch (err) {
    next(err);
  }
});

documentsRouter.get("/:docId", requirePermission("documents:view"), async (req, res, next) => {
  try {
    const doc = await getKbDocumentById(req.params.docId);
    if (!doc) {
      sendError(res, "NOT_FOUND", `Document ${req.params.docId} not found`);
      return;
    }
    res.status(200).json({ data: doc });
  } catch (err) {
    next(err);
  }
});
