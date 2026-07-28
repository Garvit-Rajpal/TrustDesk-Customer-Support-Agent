// V2-1 design system (LLD_v2 §8): "one StatusBadge component reads them
// all" — every status-shaped enum in the app (ticket status, priority, run
// status, guardrail pass/fail) renders through this single component
// instead of each view inventing its own color logic.
type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_BY_VALUE: Record<string, Tone> = {
  // ticket status (LLD_v2 §1 status machine)
  open: "info",
  in_progress: "info",
  awaiting_customer: "warning",
  customer_replied: "warning",
  resolved: "success",
  closed: "neutral",
  // priority
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
  // run status (agent_runs.status / run_events.status)
  completed: "success",
  started: "info",
  guardrail_blocked: "danger",
  blocked: "danger",
  failed: "danger",
  // guardrail pass/fail, tool action lifecycle
  passed: "success",
  requested: "info",
  approval_required: "warning",
  approved: "success",
  rejected: "danger",
  executed: "success",
  cancelled: "neutral",
};

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  const tone = TONE_BY_VALUE[value] ?? "neutral";
  return <span className={`ds-status-badge ds-status-badge--${tone}`}>{label ?? value}</span>;
}
