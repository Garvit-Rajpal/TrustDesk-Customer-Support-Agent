// Guardrail L1 — input scan (LLD §5). Pure pattern/heuristic scan over
// ticket subject+body. Never blocks triage — flags force should_escalate
// (applied by TriageService as a deterministic override, HLD invariant #1).
import { GuardrailResult } from "../../domain/schemas.js";

interface Check {
  check: string;
  pattern: RegExp;
}

// Patterns are intentionally broader than the LLD table's example phrases —
// they capture the *intent* (override instructions, extract secrets, bypass
// verification), not a fixed phrase list, so paraphrases of the same attack
// still trigger (HLD ADR-7: guardrails are generic, never ID/phrase-locked
// to the one adversarial doc/ticket seen in the seed set).
const CHECKS: Check[] = [
  {
    check: "injection_phrase",
    pattern:
      /\b(ignore|disregard)\b[^.!?]{0,40}\b(all|previous|prior)?\s*(polic(?:y|ies)|rules?|instructions?)\b|\byou are now\b|\bsystem prompt\b|\bdo not\b[^.!?]{0,20}\b(tell|mention|show)\b[^.!?]{0,20}\b(the )?(human|reviewer|agent)\b/i,
  },
  {
    check: "secret_extraction",
    pattern:
      /\b(hidden|system)\s+prompt\b|\bapi\s*key(s)?\b|\binternal\s+(notes?|instructions?)\b|\bcredentials?\b|\benvironment\s+variables?\b/i,
  },
  {
    check: "verification_bypass",
    pattern:
      /\bwithout\s+verification\b|\b(skip|bypass|waive|ignore)\b[^.!?]{0,30}\b(identity\s*check(s)?|verification|id\s*check)\b/i,
  },
];

export function inputScan(subject: string, body: string): GuardrailResult[] {
  const text = `${subject} ${body}`;

  return CHECKS.map(({ check, pattern }) => {
    const match = pattern.exec(text);
    return GuardrailResult.parse({
      layer: "input_scan",
      check,
      passed: match === null,
      detail: match ? `matched: "${match[0]}"` : undefined,
    });
  });
}

export function isFlagged(results: GuardrailResult[]): boolean {
  return results.some((r) => r.layer === "input_scan" && !r.passed);
}
