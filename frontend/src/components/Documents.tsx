import { useEffect, useState } from "react";
import { api, type DocumentSearchResult, type KbDocument, type Role } from "../api.js";

export function Documents({ role }: { role: Role }) {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [selected, setSelected] = useState<KbDocument | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showIngest, setShowIngest] = useState(false);

  function loadDocuments() {
    api
      .listDocuments()
      .then((res) => setDocuments(res.documents))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load documents"));
  }

  useEffect(loadDocuments, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setError(null);
    try {
      const res = await api.searchDocuments(query);
      setSearchResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  }

  async function openDoc(docId: string) {
    setError(null);
    try {
      setSelected(await api.getDocument(docId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    }
  }

  const listing = searchResults !== null
    ? searchResults.map((r) => ({ doc_id: r.doc_id, title: r.title, audience: r.audience, extra: `score ${r.score.toFixed(3)}` }))
    : documents.map((d) => ({ doc_id: d.doc_id, title: d.title, audience: d.audience, extra: d.version }));

  return (
    <div className="documents-layout">
      <div className="documents-list-pane">
        <h2>Knowledge base</h2>
        <form onSubmit={handleSearch} className="doc-search-form">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search KB (full-text)…"
          />
          <button type="submit">Search</button>
          {searchResults !== null && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setQuery("");
                setSearchResults(null);
              }}
            >
              Clear
            </button>
          )}
        </form>

        {error && <p className="error">{error}</p>}

        <div className="overflow-x-auto">
        <table className="queue-table">
          <thead>
            <tr>
              <th>Doc ID</th>
              <th>Title</th>
              <th>Audience</th>
              <th>{searchResults !== null ? "Score" : "Version"}</th>
            </tr>
          </thead>
          <tbody>
            {listing.map((d) => (
              <tr key={d.doc_id} className="clickable-row" onClick={() => openDoc(d.doc_id)}>
                <td>
                  <code>{d.doc_id}</code>
                </td>
                <td>{d.title}</td>
                <td>{d.audience}</td>
                <td>{d.extra}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        {/* V2-2 (LLD_v2 §3): document ingestion is admin-only. */}
        {role === "admin" && (
          <>
            <button className="link-button" onClick={() => setShowIngest((v) => !v)}>
              {showIngest ? "Hide" : "+ Ingest new document"}
            </button>
            {showIngest && (
              <IngestForm
                onIngested={() => {
                  setShowIngest(false);
                  loadDocuments();
                }}
              />
            )}
          </>
        )}
      </div>

      <div className="documents-detail-pane">
        {selected ? (
          <>
            <h3>{selected.title}</h3>
            <p className="muted">
              <code>{selected.doc_id}</code> · {selected.audience} · v{selected.version} · {selected.source_path}
            </p>
            <pre className="json-panel doc-content">{selected.content}</pre>
          </>
        ) : (
          <p className="muted">Select a document to view its full content.</p>
        )}
      </div>
    </div>
  );
}

function IngestForm({ onIngested }: { onIngested: () => void }) {
  const [docId, setDocId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState("Customer support agents");
  const [version, setVersion] = useState("2026.07");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // source_path is provenance metadata for docs that came from a real
      // file (seed data, policy packs) — a document typed in here has no
      // such path, so we simply don't send one; the backend fills in a
      // synthetic label (see POST /documents/ingest).
      await api.ingestDocuments([{ doc_id: docId, title, content, audience, version }]);
      onIngested();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ingest-form">
      <label>
        doc_id
        <input value={docId} onChange={(e) => setDocId(e.target.value)} placeholder="KB-CUSTOM-001" required />
      </label>
      <label>
        title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <div className="ingest-row">
        <label>
          audience
          <input value={audience} onChange={(e) => setAudience(e.target.value)} />
        </label>
        <label>
          version
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
      </div>
      <label>
        content
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6} required />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Ingesting…" : "Ingest document"}
      </button>
    </form>
  );
}
