// Deterministic, code-authored fail-closed substitute (LLD §5). Used when
// L3 output scan fails a fail-closed check, OR the model's raw output
// couldn't be parsed into RawDraftOutput at all even after retry — either
// way, we never ship generated text we couldn't validate (HLD invariant #5:
// discard + substitute, never redact in place).
export const ESCALATION_TEMPLATE_BODY =
  "Thanks for reaching out. This request needs a closer look from a member of our support team before we can respond further. We've flagged it for a specialist, and someone will follow up with you shortly.";
