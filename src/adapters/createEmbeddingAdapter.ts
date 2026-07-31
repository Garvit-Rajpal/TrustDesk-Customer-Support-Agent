// Picks the adapter for the configured EMBEDDING_TIER (LLD_v4 §5, HLD_v4
// ADR-21) — mirrors createModelAdapter.ts's MODEL_TIER pattern exactly,
// with one deliberate difference: the "hosted" tier is inferred ONLY from
// EMBEDDINGS_API_KEY, never from OPENAI_API_KEY. That key points at
// OpenRouter (see CLAUDE.md's own .env comment), which has no embeddings
// endpoint — reusing it here would silently point at the wrong API.
import type { EmbeddingAdapter } from "./embeddingAdapter.js";
import { EmbeddingHttpAdapter } from "./embeddingHttp.js";
import { MockEmbeddingAdapter } from "./mockEmbedding.js";

export type EmbeddingTier = "mock" | "local" | "hosted";

const VALID_TIERS: EmbeddingTier[] = ["mock", "local", "hosted"];

export function resolveEmbeddingTier(env: NodeJS.ProcessEnv = process.env): EmbeddingTier {
  const raw = env.EMBEDDING_TIER;
  if (raw && (VALID_TIERS as string[]).includes(raw)) {
    return raw as EmbeddingTier;
  }
  return env.EMBEDDINGS_API_KEY ? "hosted" : "mock";
}

export function createEmbeddingAdapter(env: NodeJS.ProcessEnv = process.env): EmbeddingAdapter {
  const tier = resolveEmbeddingTier(env);

  switch (tier) {
    // A small, purchased embeddings API at deploy time — distinct
    // credential/endpoint from the OpenRouter-pointed OPENAI_API_KEY.
    case "hosted":
      return new EmbeddingHttpAdapter({
        baseUrl: env.EMBEDDINGS_BASE_URL,
        apiKey: env.EMBEDDINGS_API_KEY ?? "",
        model: env.EMBEDDING_MODEL_NAME,
      });

    // Ollama's OpenAI-compatible server, same local dev story
    // OPENAI_BASE_URL_LOCAL already supports for chat completions — doesn't
    // check the Authorization header, so a placeholder key is fine.
    case "local":
      return new EmbeddingHttpAdapter({
        baseUrl: env.OPENAI_BASE_URL_LOCAL ?? "http://localhost:11434/v1",
        apiKey: env.EMBEDDINGS_API_KEY ?? "ollama-local",
        model: env.EMBEDDING_MODEL_NAME ?? "nomic-embed-text",
      });

    case "mock":
    default:
      console.warn(
        "[trustdesk] EMBEDDING_TIER=mock (or unset with no EMBEDDINGS_API_KEY) — running with MockEmbeddingAdapter, not a real embedding model."
      );
      return new MockEmbeddingAdapter();
  }
}
