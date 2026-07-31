// V4-8 (LLD_v4 §4, HLD_v4 ADR-20): eval-run streaming progress — same
// EventSource-over-SSE pattern RunStepper.tsx already proves for
// single-ticket runs, applied to a whole eval batch's "eval_case" stage
// events (one started/completed pair per case, LLD_v4 §4). Rotating copy
// keeps the run feeling alive during the several-second gap a case with
// the W16 layered guardrails can take.
import { useEffect, useRef, useState } from "react";
import { getToken } from "../api.js";

interface CaseProgress {
  caseId: string;
  status: "started" | "completed" | "failed";
  index: number;
  total: number;
}

const ROTATING_COPY = [
  "Running triage…",
  "Retrieving policy docs…",
  "Checking guardrails…",
  "Scoring against expected labels…",
  "Drafting a reply…",
];

// Mirrors src/services/events/pipelineEventBus.ts#isTerminalEvent's
// eval_case branch — terminal only on the LAST case's completion.
function isTerminal(status: string, index: number, total: number): boolean {
  return (status === "completed" || status === "failed") && index === total;
}

export function EvalRunStepper({ evalRunId }: { evalRunId: string | null }) {
  const [cases, setCases] = useState<CaseProgress[]>([]);
  const [done, setDone] = useState(false);
  const [copyIndex, setCopyIndex] = useState(0);

  useEffect(() => {
    setCases([]);
    setDone(false);
    setCopyIndex(0);
    if (!evalRunId) return;

    const token = getToken();
    const url = `/eval-runs/${evalRunId}/events?token=${encodeURIComponent(token ?? "")}`;
    const source = new EventSource(url);

    source.onmessage = (evt) => {
      const data = JSON.parse(evt.data) as {
        stage: string;
        status: "started" | "completed" | "failed";
        summary: { case_id?: string; counts?: { index: number; total: number } };
      };
      if (data.stage !== "eval_case" || !data.summary.case_id || !data.summary.counts) return;

      const { case_id, counts } = data.summary;
      setCases((prev) => {
        const next = prev.filter((c) => c.caseId !== case_id);
        next.push({ caseId: case_id, status: data.status, index: counts.index, total: counts.total });
        return next.sort((a, b) => a.index - b.index);
      });

      if (isTerminal(data.status, counts.index, counts.total)) {
        setDone(true);
        source.close();
      }
    };
    source.onerror = () => source.close();

    return () => source.close();
  }, [evalRunId]);

  // Cycles the rotating status line while the run is in flight — stops the
  // moment a terminal event lands, per the effect below.
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    if (!evalRunId) return;
    const interval = setInterval(() => {
      if (doneRef.current) return;
      setCopyIndex((i) => (i + 1) % ROTATING_COPY.length);
    }, 1600);
    return () => clearInterval(interval);
  }, [evalRunId]);

  if (!evalRunId || cases.length === 0) return null;

  const latest = cases[cases.length - 1]!;

  return (
    <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-ds-text">
          {done ? "Eval run complete" : `Case ${latest.index} of ${latest.total}: ${latest.caseId}`}
        </span>
        {!done && <span className="text-ds-text-muted">{ROTATING_COPY[copyIndex]}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {cases.map((c) => (
          <span
            key={c.caseId}
            className={`rounded-ds-sm px-2 py-0.5 text-xs ${
              c.status === "completed"
                ? "bg-status-success-bg text-status-success-fg"
                : c.status === "failed"
                  ? "bg-status-danger-bg text-status-danger-fg"
                  : "bg-status-info-bg text-status-info-fg"
            }`}
          >
            {c.caseId} {c.status === "started" ? "…" : c.status === "completed" ? "✓" : "✗"}
          </span>
        ))}
      </div>
    </div>
  );
}
