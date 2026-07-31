// V2-1 (LLD_v2 §2, ADR-8): the single gate a stage summary must pass
// through before it can reach run_events or the SSE wire. An allowlist, not
// a blocklist — anything not explicitly named here is dropped, so a future
// caller accidentally spreading a raw model draft or prompt text into a
// summary object can never leak it onto the wire.
const ALLOWED_KEYS = [
  "doc_ids",
  "check",
  "passed",
  "category",
  "resolution_type",
  "counts",
  "durations",
  // V4-5 (LLD_v4 §4): eval-case stage events name which case is running —
  // a public eval_cases.jsonl identifier (e.g. "eval_003"), no different in
  // sensitivity from a ticket_id already visible elsewhere on the wire.
  "case_id",
] as const;

export function redactSummary(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (key in input) {
      out[key] = input[key];
    }
  }
  return out;
}
