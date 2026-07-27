// Guardrail L3 — output scan (LLD §5). Pure function over the model's raw
// draft output plus deterministic context. Fail-closed semantics live in
// DraftService (milestone 6): when `passed` is false here, the caller
// discards the model draft entirely and substitutes a code-authored
// template (HLD invariant #5) — this module only detects, never redacts.
import { GuardrailResult, RawDraftOutput } from "../../domain/schemas.js";
import type { ToolCatalogEntry } from "../../domain/entities.js";

export interface OutputScanContext {
  retrievedDocIds: string[];
  // Docs whose audience is not the standard customer-facing one (HLD §5:
  // "internal docs ... may be retrieved and cited... restriction is on the
  // draft body"). Callers pass content for ANY non-standard-audience doc —
  // detection here never checks a doc_id (ADR-7).
  internalAudienceDocs: { doc_id: string; content: string }[];
  systemPromptText: string;
  ticketCustomer: { customer_id: string; email: string };
  ticketCategory: string;
  toolCatalog: ToolCatalogEntry[];
}

export interface OutputScanResult {
  results: GuardrailResult[];
  // false only when a fail-closed check (citation_subset, internal_leak,
  // secret_leak, unrelated_customer) failed. action_validity failures strip
  // actions but never flip this — LLD §5: "strip invalid action(s) ... keep
  // draft".
  passed: boolean;
  sanitizedActions: RawDraftOutput["recommended_actions"];
}

const FAIL_CLOSED_CHECKS = new Set(["citation_subset", "internal_leak", "secret_leak", "unrelated_customer"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const NGRAM_SIZE = 8;

function ngrams(tokens: string[], n: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    set.add(tokens.slice(i, i + n).join(" "));
  }
  return set;
}

// True if `body` shares any n-word run (n = NGRAM_SIZE) with `source`.
function hasVerbatimOverlap(body: string, source: string): boolean {
  const bodyGrams = ngrams(tokenize(body), NGRAM_SIZE);
  if (bodyGrams.size === 0) return false;
  const sourceGrams = ngrams(tokenize(source), NGRAM_SIZE);
  for (const g of bodyGrams) {
    if (sourceGrams.has(g)) return true;
  }
  return false;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[a-z0-9]{10,}\b/i, // OpenAI-style API key
  /\bBearer\s+[a-z0-9\-_.]{10,}\b/i, // bearer token
  /\b[0-9a-f]{32,}\b/i, // 32+ hex string (raw key/secret material)
  /\b(OPENAI_API_KEY|OPENAI_BASE_URL|JWT_SECRET|DATABASE_URL)\b/, // env var names
];

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const CUSTOMER_ID_PATTERN = /\bcus_[a-z0-9]+\b/gi;

function checkCitationSubset(draft: RawDraftOutput, ctx: OutputScanContext): GuardrailResult {
  const unknown = draft.citations.filter((c) => !ctx.retrievedDocIds.includes(c));
  return GuardrailResult.parse({
    layer: "output_scan",
    check: "citation_subset",
    passed: unknown.length === 0,
    detail: unknown.length > 0 ? `uncited-retrieval doc ids: ${unknown.join(", ")}` : undefined,
  });
}

function checkInternalLeak(draft: RawDraftOutput, ctx: OutputScanContext): GuardrailResult {
  const leakedDoc = ctx.internalAudienceDocs.find((d) => hasVerbatimOverlap(draft.body, d.content));
  const leakedPrompt = hasVerbatimOverlap(draft.body, ctx.systemPromptText);
  const passed = !leakedDoc && !leakedPrompt;
  return GuardrailResult.parse({
    layer: "output_scan",
    check: "internal_leak",
    passed,
    detail: leakedDoc
      ? `overlaps internal doc ${leakedDoc.doc_id}`
      : leakedPrompt
        ? "overlaps system prompt text"
        : undefined,
  });
}

function checkSecretLeak(draft: RawDraftOutput): GuardrailResult {
  const matched = SECRET_PATTERNS.find((p) => p.test(draft.body));
  return GuardrailResult.parse({
    layer: "output_scan",
    check: "secret_leak",
    passed: !matched,
    detail: matched ? "body matches a secret/key-format pattern" : undefined,
  });
}

function checkUnrelatedCustomer(draft: RawDraftOutput, ctx: OutputScanContext): GuardrailResult {
  const emails = draft.body.match(EMAIL_PATTERN) ?? [];
  const otherEmail = emails.find((e) => e.toLowerCase() !== ctx.ticketCustomer.email.toLowerCase());

  const customerIds = draft.body.match(CUSTOMER_ID_PATTERN) ?? [];
  const otherId = customerIds.find((id) => id.toLowerCase() !== ctx.ticketCustomer.customer_id.toLowerCase());

  const passed = !otherEmail && !otherId;
  return GuardrailResult.parse({
    layer: "output_scan",
    check: "unrelated_customer",
    passed,
    detail: otherEmail
      ? `body references unrelated email ${otherEmail}`
      : otherId
        ? `body references unrelated customer_id ${otherId}`
        : undefined,
  });
}

// Not fail-closed: strips invalid actions and reports the failure, but the
// draft body itself is unaffected (LLD §5).
function checkActionValidity(
  draft: RawDraftOutput,
  ctx: OutputScanContext
): { result: GuardrailResult; sanitizedActions: RawDraftOutput["recommended_actions"] } {
  const invalidReasons: string[] = [];
  const sanitizedActions = draft.recommended_actions.filter((action) => {
    const tool = ctx.toolCatalog.find((t) => t.tool_name === action.tool_name);
    if (!tool) {
      invalidReasons.push(`${action.tool_name}: not in catalog`);
      return false;
    }
    if (!tool.allowed_categories.includes(ctx.ticketCategory)) {
      invalidReasons.push(`${action.tool_name}: not allowed for category ${ctx.ticketCategory}`);
      return false;
    }
    const amount = action.payload_hints?.amount;
    if (tool.max_amount_inr != null && typeof amount === "number" && amount > tool.max_amount_inr) {
      invalidReasons.push(`${action.tool_name}: amount ${amount} exceeds max_amount_inr ${tool.max_amount_inr}`);
      return false;
    }
    return true;
  });

  return {
    result: GuardrailResult.parse({
      layer: "output_scan",
      check: "action_validity",
      passed: invalidReasons.length === 0,
      detail: invalidReasons.length > 0 ? invalidReasons.join("; ") : undefined,
    }),
    sanitizedActions,
  };
}

export function outputScan(draft: RawDraftOutput, ctx: OutputScanContext): OutputScanResult {
  const citationResult = checkCitationSubset(draft, ctx);
  const internalLeakResult = checkInternalLeak(draft, ctx);
  const secretLeakResult = checkSecretLeak(draft);
  const unrelatedCustomerResult = checkUnrelatedCustomer(draft, ctx);
  const { result: actionValidityResult, sanitizedActions } = checkActionValidity(draft, ctx);

  const results = [
    citationResult,
    internalLeakResult,
    secretLeakResult,
    unrelatedCustomerResult,
    actionValidityResult,
  ];

  const passed = results
    .filter((r) => FAIL_CLOSED_CHECKS.has(r.check))
    .every((r) => r.passed);

  return { results, passed, sanitizedActions };
}
