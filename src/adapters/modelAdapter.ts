// ModelAdapter (HLD ADR-3): the only interface that knows about AI HTTP
// APIs. Every service that needs the model calls this — never an HTTP
// client directly — so provider swap and test mocking both stay trivial.
export interface ModelRequest {
  // Routes an OpenRouterAdapter call to the right model; MockModelAdapter
  // uses it purely as a lookup key for canned responses (LLD §1: "canned,
  // per-scenario responses").
  scenario: string;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: "json";
}

export interface ModelResponse {
  content: string;
  model: string;
  provider: string;
}

export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
