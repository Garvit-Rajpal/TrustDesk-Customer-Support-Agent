import { useState } from "react";
import { api, type FeedbackResult } from "../api.js";

// V2-3 (LLD_v2 §4/§8): "rating control on draft panel." Every role can
// submit feedback (LLD_v2 §3); resubmitting updates the reviewer's own
// rating rather than creating a second row (server-side upsert on
// (draft_id, reviewer_id)).
export function FeedbackControl({ draftId }: { draftId: string }) {
  const [submitted, setSubmitted] = useState<FeedbackResult | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rate(rating: number) {
    setError(null);
    setBusy(true);
    try {
      setSubmitted(await api.submitFeedback(draftId, { rating, reason: reason || undefined }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback failed");
    } finally {
      setBusy(false);
    }
  }

  const current = submitted?.rating ?? 0;

  return (
    <div className="feedback-control">
      <div className="feedback-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            className={`star-button${n <= current ? " star-button--filled" : ""}`}
            onClick={() => rate(n)}
            aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
          >
            ★
          </button>
        ))}
        {submitted && <span className="muted">You rated this {submitted.rating}/5</span>}
      </div>
      <input
        className="feedback-reason"
        placeholder="Optional note (why this rating?)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
