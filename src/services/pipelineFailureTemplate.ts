// A deterministic fallback posted to the ticket thread whenever the AI
// pipeline itself fails (e.g. the model's output never passes schema
// validation, or the adapter call throws) — distinct from a guardrail
// L3 fail-closed substitution (guardrails/templates/), which fires when
// the model *succeeds* but produces unsafe/leaking content. No model
// call, no per-vertical variants (unlike ticketGreeting.ts) — this is an
// internal-failure notice, not marketing-adjacent copy.
export const PIPELINE_FAILURE_TEXT =
  "We're having trouble processing your message right now. A support specialist has been notified and will follow up shortly.";
