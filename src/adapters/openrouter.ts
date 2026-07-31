// OpenRouterAdapter (HLD ADR-3, LLD §8): OpenAI-compatible HTTP client.
// Plain fetch rather than the `openai` SDK — OpenRouter's chat/completions
// endpoint is a thin OpenAI-compatible surface, and a fetch-based client
// avoids pulling in a whole SDK for one endpoint shape.
import type { ModelAdapter, ModelRequest, ModelResponse } from "./modelAdapter.js";
import { withRetries } from "./httpRetry.js";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

export interface OpenRouterConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export class OpenRouterAdapter implements ModelAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: OpenRouterConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1";
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = config.model ?? process.env.MODEL_NAME ?? "openrouter/auto";
    if (!this.apiKey) {
      throw new Error("OpenRouterAdapter requires OPENAI_API_KEY");
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    return withRetries(() => this.callOnce(request), MAX_RETRIES);
  }

  private async callOnce(request: ModelRequest): Promise<ModelResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`OpenRouter request failed: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as {
        model?: string;
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new Error("OpenRouter response missing choices[0].message.content");
      }

      return { content, model: data.model ?? this.model, provider: "openrouter" };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

