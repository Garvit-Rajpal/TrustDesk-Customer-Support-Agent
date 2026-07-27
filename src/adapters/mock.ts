// MockModelAdapter (LLD §1/§8): default AI adapter in every test — no test
// ever calls OpenRouter. Scenarios are keyed by ModelRequest.scenario; each
// key holds a queue of canned responses so a test can script a
// invalid-then-valid retry, or an always-invalid failure path.
import type { ModelAdapter, ModelRequest, ModelResponse } from "./modelAdapter.js";

export interface MockResponseSpec {
  content: string;
  model?: string;
  provider?: string;
}

export class MockModelAdapter implements ModelAdapter {
  private readonly callCounts = new Map<string, number>();

  constructor(private readonly scenarios: Record<string, MockResponseSpec | MockResponseSpec[]>) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const spec = this.scenarios[request.scenario];
    if (!spec) {
      throw new Error(`MockModelAdapter: no scenario registered for "${request.scenario}"`);
    }
    const queue = Array.isArray(spec) ? spec : [spec];
    const callIndex = this.callCounts.get(request.scenario) ?? 0;
    // Once the queue is exhausted, keep returning the last entry — lets a
    // test declare only as many responses as it cares to distinguish.
    const chosen = queue[Math.min(callIndex, queue.length - 1)]!;
    this.callCounts.set(request.scenario, callIndex + 1);

    return {
      content: chosen.content,
      model: chosen.model ?? "mock-model",
      provider: chosen.provider ?? "mock",
    };
  }

  callCount(scenario: string): number {
    return this.callCounts.get(scenario) ?? 0;
  }
}
