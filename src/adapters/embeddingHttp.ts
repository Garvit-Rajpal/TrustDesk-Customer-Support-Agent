// EmbeddingHttpAdapter (HLD_v4 ADR-21, LLD_v4 §5): OpenAI-compatible
// /embeddings client — used for BOTH the "local" tier (Ollama's
// OpenAI-compatible server) and the "hosted" tier (a purchased embeddings
// API), same as OpenRouterAdapter is reused for both "local" and "hosted"
// MODEL_TIER in createModelAdapter.ts. Plain fetch, not an SDK — same
// reasoning as OpenRouterAdapter.
import type { EmbeddingAdapter } from "./embeddingAdapter.js";
import { withRetries } from "./httpRetry.js";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

export interface EmbeddingHttpConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export class EmbeddingHttpAdapter implements EmbeddingAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: EmbeddingHttpConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:11434/v1";
    this.apiKey = config.apiKey ?? "";
    this.model = config.model ?? "nomic-embed-text";
    if (!this.apiKey) {
      throw new Error("EmbeddingHttpAdapter requires an API key");
    }
  }

  async embed(text: string): Promise<number[]> {
    return withRetries(() => this.embedOnce(text), MAX_RETRIES);
  }

  private async embedOnce(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Embedding request failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as { data?: { embedding?: number[] }[] };
      const embedding = data.data?.[0]?.embedding;
      if (!Array.isArray(embedding)) {
        throw new Error("Embedding response missing data[0].embedding");
      }
      return embedding;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
