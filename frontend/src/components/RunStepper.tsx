// V2-1 (LLD_v2 §2, ADR-8): "one component renders identically for live and
// historical runs." It opens the SSE endpoint on mount; since triage/draft
// finish synchronously before their POST response returns (HLD invariant
// #6), what streams back in this app today is always a full replay — but
// the same EventSource-driven render path is what a genuinely in-progress
// run would use too, so there is nothing separate to build later for "live".
import { useEffect, useState } from "react";
import { getToken } from "../api.js";

const STAGE_ORDER = [
  "input_scan",
  "triage",
  "retrieval",
  "eligibility",
  "draft_generation",
  "output_scan",
] as const;

const STAGE_LABELS: Record<string, string> = {
  input_scan: "Input scan",
  triage: "Triage",
  retrieval: "Retrieval",
  eligibility: "Eligibility",
  draft_generation: "Draft generation",
  output_scan: "Output scan",
};

const DOT_ICON: Record<string, string> = {
  started: "…",
  completed: "✓",
  blocked: "✗",
  failed: "✗",
};

// Mirrors src/services/events/pipelineEventBus.ts#isTerminalEvent — once a
// terminal stage/status is seen, this run will never emit again, so the
// client closes its own connection instead of waiting on the server to.
function isTerminal(stage: string, status: string): boolean {
  if (stage === "triage" && (status === "completed" || status === "failed")) return true;
  if (stage === "output_scan") return true;
  if (stage === "draft_generation" && status === "failed") return true;
  return false;
}

export function RunStepper({ ticketId, runId }: { ticketId: string; runId: string | null | undefined }) {
  const [stages, setStages] = useState<Record<string, string>>({});

  useEffect(() => {
    setStages({});
    if (!runId) return;

    const token = getToken();
    const url = `/tickets/${ticketId}/runs/${runId}/events?token=${encodeURIComponent(token ?? "")}`;
    const source = new EventSource(url);

    source.onmessage = (evt) => {
      const data = JSON.parse(evt.data) as { stage: string; status: string };
      setStages((prev) => ({ ...prev, [data.stage]: data.status }));
      if (isTerminal(data.stage, data.status)) {
        source.close();
      }
    };
    source.onerror = () => {
      source.close();
    };

    return () => source.close();
  }, [ticketId, runId]);

  const seenStages = STAGE_ORDER.filter((s) => stages[s]);
  if (!runId || seenStages.length === 0) return null;

  return (
    <div className="ds-run-stepper">
      {seenStages.map((stage) => {
        const status = stages[stage]!;
        return (
          <div key={stage} className={`ds-run-step ds-run-step--${status}`}>
            <span className="ds-run-step-dot">{DOT_ICON[status] ?? "•"}</span>
            <span className="ds-run-step-label">{STAGE_LABELS[stage]}</span>
          </div>
        );
      })}
    </div>
  );
}
