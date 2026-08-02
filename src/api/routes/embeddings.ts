// RAG-pipeline visibility: the resolution-embedding index itself (what
// ingestResolutionEmbedding()/ticketThread.ts has written to
// ticket_resolution_embeddings on ticket resolve). Restricted to
// org_default — same pattern POST /orgs and platform.ts already use to
// deliberately narrow a route to the one tenant this demo's fixtures were
// built around, rather than a real per-tenant-opt-in capability like
// consent-gated platform support.
import { Router } from "express";
import { listResolutionEmbeddings } from "../../db/repos/resolutionEmbeddingsRepo.js";
import { sendError } from "../errorEnvelope.js";
import { requirePermission } from "../middleware/permissions.js";

export const embeddingsRouter = Router();

embeddingsRouter.get("/", requirePermission("embeddings:view"), async (req, res, next) => {
  try {
    if (req.orgContext!.org_id !== "org_default") {
      sendError(res, "FORBIDDEN", "Only org_default may view the resolution-embedding index");
      return;
    }
    const embeddings = await listResolutionEmbeddings(req.orgContext!);
    res.status(200).json({ data: { embeddings } });
  } catch (err) {
    next(err);
  }
});
