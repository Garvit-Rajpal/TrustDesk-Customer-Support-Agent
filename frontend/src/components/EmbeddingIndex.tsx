import { useEffect, useState } from "react";
import { api, type ResolutionEmbeddingSummary } from "../api.js";
import { DataTable, type DataTableColumn } from "../design-system/DataTable.js";
import { Modal } from "../design-system/Modal.js";

const COLUMNS: DataTableColumn<ResolutionEmbeddingSummary>[] = [
  { key: "created_at", header: "Ingested", render: (e) => new Date(e.created_at).toLocaleString() },
  {
    key: "ticket",
    header: "Ticket",
    render: (e) => `${e.ticket_id} — ${e.ticket_subject ?? ""}`,
  },
  { key: "customer", header: "Customer", render: (e) => e.customer_name ?? "—" },
  { key: "category", header: "Category", render: (e) => e.category },
  { key: "resolution_type", header: "Resolution type", render: (e) => e.resolution_type },
];

// RAG-pipeline visibility, org_default only (GET /embeddings 403s any other
// org — src/api/routes/embeddings.ts): the resolution-embedding index
// itself — every row ticketThread.ts's ingestResolutionEmbedding() has
// written on a ticket resolve with a sent draft. This is the "supply" side
// of the RAG loop; TracePanel's "Similar past resolutions used" section
// (on a draft_reply run) is the "demand" side — what a later draft actually
// retrieved from this index. See docs/embedding_lifecycle.mermaid for the
// full loop.
export function EmbeddingIndex() {
  const [embeddings, setEmbeddings] = useState<ResolutionEmbeddingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ResolutionEmbeddingSummary | null>(null);

  useEffect(() => {
    api
      .listResolutionEmbeddings()
      .then((res) => setEmbeddings(res.embeddings))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load embedding index"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading embedding index…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <p className="muted">
        Every resolved ticket's sent draft that has been embedded into the similarity index, most
        recent first — {embeddings.length} embedding{embeddings.length === 1 ? "" : "s"}. A later
        ticket's draft generation searches this index (org + category scoped, cosine distance) for
        up to 3 nearest matches, fed into its prompt as phrasing context — never a citable source.
        Click a row to see the indexed text.
      </p>
      {embeddings.length === 0 ? (
        <p className="muted">
          No embeddings yet — resolving a ticket with a sent AI draft adds one here.
        </p>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={embeddings}
          rowKey={(e) => e.embedding_id}
          onRowClick={(e) => setSelected(e)}
        />
      )}

      {selected && (
        <Modal title={selected.embedding_id} onClose={() => setSelected(null)} size="lg">
          <p className="muted">
            <code>{selected.ticket_id}</code> · {selected.category} · {selected.resolution_type} ·{" "}
            {new Date(selected.created_at).toLocaleString()}
          </p>
          <pre className="json-panel">{selected.source_text}</pre>
        </Modal>
      )}
    </div>
  );
}
