// Guardrail org-policy-pack rule layer (V4-16, LLD_v4 §6, HLD_v4 ADR-22).
// Same regex-check shape as inputScan.ts (a CHECKS array evaluated with
// GuardrailResult.parse) — declarative rule *content* lives outside code, in
// src/policy_packs/{vertical}/guardrail_rules.json, one file per vertical,
// alongside that vertical's existing markdown policy docs (see
// orgOnboarding.ts's PACKS_DIR). Rules are looked up strictly by the caller-
// supplied vertical, so an org can only ever be scanned against its own
// vertical's rules (cross-vertical isolation is structural, not a runtime
// check).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GuardrailResult, RawDraftOutput } from "../../domain/schemas.js";
import type { Vertical } from "../../domain/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = path.resolve(__dirname, "../../policy_packs");

const VERTICALS: Vertical[] = ["retail_ecommerce", "software", "finance"];

interface RawRule {
  check: string;
  pattern: string;
  layer?: string;
}

interface CompiledRule {
  check: string;
  regex: RegExp;
}

function loadRules(vertical: Vertical): CompiledRule[] {
  const filePath = path.join(PACKS_DIR, vertical, "guardrail_rules.json");
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as { rules: RawRule[] };
  return raw.rules.map((r) => ({ check: r.check, regex: new RegExp(r.pattern, "i") }));
}

// Loaded once at module init, same "static config read at startup" idiom
// DEFAULT_MODEL_SCENARIOS uses — request-time cost is just a regex test.
const RULES_BY_VERTICAL: Record<Vertical, CompiledRule[]> = Object.fromEntries(
  VERTICALS.map((vertical) => [vertical, loadRules(vertical)])
) as Record<Vertical, CompiledRule[]>;

export function orgPolicyScan(draft: RawDraftOutput, vertical: Vertical): GuardrailResult[] {
  const rules = RULES_BY_VERTICAL[vertical] ?? [];
  return rules.map(({ check, regex }) => {
    const match = regex.exec(draft.body);
    return GuardrailResult.parse({
      layer: "org_policy",
      check,
      passed: match === null,
      detail: match ? `matched: "${match[0]}"` : undefined,
    });
  });
}
