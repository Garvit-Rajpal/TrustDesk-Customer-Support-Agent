// V2-1 (LLD_v2 §2, ADR-8): in-process event bus a pipeline stage calls into
// as it runs. Two effects per call, in order: (1) persist the redacted
// event to run_events so historical runs can be replayed, (2) broadcast it
// to any SSE subscriber currently listening for this run_id. Persisting
// first means a client that subscribes a moment later never misses an event
// that already made it into the table (the SSE route replays the table
// before subscribing live).
import { EventEmitter } from "node:events";
import type { PipelineEventStatus, PipelineStage, RunEvent } from "../../domain/schemas.js";
import { redactSummary } from "./redactSummary.js";
import { insertRunEvent } from "../../db/repos/runEventsRepo.js";

class PipelineEventBus extends EventEmitter {
  constructor() {
    super();
    // Many tickets can have runs in flight (and each SSE connection adds a
    // listener); this isn't a leak signal in this app, so raise the cap
    // rather than silence the warning wholesale.
    this.setMaxListeners(100);
  }

  async emitStage(
    runId: string,
    stage: PipelineStage,
    status: PipelineEventStatus,
    rawSummary: Record<string, unknown> = {}
  ): Promise<void> {
    const summary = redactSummary(rawSummary);
    await insertRunEvent({ run_id: runId, stage, status, summary });

    const event: RunEvent = { run_id: runId, stage, status, summary, ts: new Date().toISOString() };
    this.emit(channel(runId), event);
  }

  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.on(channel(runId), listener);
    return () => this.off(channel(runId), listener);
  }
}

function channel(runId: string): string {
  return `run:${runId}`;
}

export const pipelineEventBus = new PipelineEventBus();

// A run is exactly one of: a triage run (stages input_scan, triage) or a
// draft run (stages input_scan, retrieval, eligibility, draft_generation,
// output_scan — see src/services/draft.ts). This tells the SSE route (LLD_v2
// §2) when it has seen the last event for a run and can safely end the
// stream instead of holding the connection open forever.
export function isTerminalEvent(event: RunEvent): boolean {
  if (event.stage === "triage" && (event.status === "completed" || event.status === "failed")) {
    return true;
  }
  if (event.stage === "output_scan") {
    return true;
  }
  if (event.stage === "draft_generation" && event.status === "failed") {
    return true;
  }
  // V4-5 (LLD_v4 §4): an eval run's run_id (its eval_run_id) emits one
  // "eval_case" started/completed(or failed) pair per case — terminal only
  // on the LAST case's completion, identified by its own counts.index/total
  // (no new EventSummary field needed; `counts` already exists for this).
  if (
    event.stage === "eval_case" &&
    (event.status === "completed" || event.status === "failed") &&
    event.summary.counts?.index === event.summary.counts?.total
  ) {
    return true;
  }
  return false;
}
