// Picks the live OpenRouterAdapter when OPENAI_API_KEY is configured,
// otherwise falls back to the demo MockModelAdapter (ADR-3). Used ONLY by
// server.ts — app.ts's default export stays hardcoded to the mock adapter
// so importing `app` in a test can never accidentally reach OpenRouter,
// regardless of what's in a developer's .env (LLD §1 invariant).
import type { ModelAdapter } from "./modelAdapter.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { MockModelAdapter } from "./mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "./defaultMockScenarios.js";

export function createModelAdapter(): ModelAdapter {
  if (process.env.OPENAI_API_KEY) {
    return new OpenRouterAdapter();
  }
  console.warn(
    "[trustdesk] OPENAI_API_KEY not set — running with MockModelAdapter demo scenarios, not a live model."
  );
  return new MockModelAdapter(DEFAULT_MODEL_SCENARIOS);
}
