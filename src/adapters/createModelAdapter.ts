// Picks the adapter for the configured MODEL_TIER (LLD_v2 §7). Used ONLY by
// server.ts and scripts/smokeLocal.ts — app.ts's default export stays
// hardcoded to the mock adapter so importing `app` in a test can never
// accidentally reach OpenRouter or Ollama, regardless of what's in a
// developer's .env (LLD §1 invariant).
import type { ModelAdapter } from "./modelAdapter.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { MockModelAdapter } from "./mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "./defaultMockScenarios.js";

export type ModelTier = "mock" | "local" | "hosted";

const VALID_TIERS: ModelTier[] = ["mock", "local", "hosted"];

// Exported for the config-selection unit test. Explicit MODEL_TIER wins;
// otherwise fall back to the v1 behavior of inferring from OPENAI_API_KEY
// so existing .env files (no MODEL_TIER set) keep working unchanged.
export function resolveModelTier(env: NodeJS.ProcessEnv = process.env): ModelTier {
  const raw = env.MODEL_TIER;
  if (raw && (VALID_TIERS as string[]).includes(raw)) {
    return raw as ModelTier;
  }
  return env.OPENAI_API_KEY ? "hosted" : "mock";
}

export function createModelAdapter(env: NodeJS.ProcessEnv = process.env): ModelAdapter {
  const tier = resolveModelTier(env);

  switch (tier) {
    // Pass env explicitly rather than relying on OpenRouterAdapter's own
    // process.env fallback, so an injected `env` (as the unit tests use)
    // is actually honored instead of silently reading the real process.env.
    case "hosted":
      return new OpenRouterAdapter({
        baseUrl: env.OPENAI_BASE_URL,
        apiKey: env.OPENAI_API_KEY ?? "",
        model: env.MODEL_NAME,
      });

    // Ollama's OpenAI-compatible server (LLD_v2 §7) doesn't check the
    // Authorization header at all, but OpenRouterAdapter's constructor
    // requires a non-empty apiKey — so supply a placeholder when the
    // developer hasn't set one.
    case "local":
      return new OpenRouterAdapter({
        baseUrl: env.OPENAI_BASE_URL_LOCAL ?? "http://localhost:11434/v1",
        apiKey: env.OPENAI_API_KEY ?? "ollama-local",
        model: env.MODEL_NAME ?? "qwen2.5:3b",
      });

    case "mock":
    default:
      console.warn(
        "[trustdesk] MODEL_TIER=mock (or unset with no OPENAI_API_KEY) — running with MockModelAdapter demo scenarios, not a live model."
      );
      return new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
  }
}
