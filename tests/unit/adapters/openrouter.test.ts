// Milestone 9: OpenRouterAdapter — retries(2, backoff), 30s timeout (ADR-3).
// `fetch` is fully mocked here; this suite never makes a real network call,
// per LLD §1 ("no test ever calls OpenRouter").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterAdapter } from "../../../src/adapters/openrouter.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("OpenRouterAdapter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws at construction time when no API key is available", () => {
    expect(() => new OpenRouterAdapter({ apiKey: "" })).toThrow(/OPENAI_API_KEY/);
  });

  it("sends system+user messages, model, and Authorization header", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ model: "openrouter/auto", choices: [{ message: { content: "{}" } }] })
    );
    const adapter = new OpenRouterAdapter({ apiKey: "test-key", model: "test-model" });

    await adapter.complete({ scenario: "x", systemPrompt: "sys", userPrompt: "usr", responseFormat: "json" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/chat\/completions$/);
    expect(options.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("omits response_format when not requested", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "hi" } }] }));
    const adapter = new OpenRouterAdapter({ apiKey: "k" });

    await adapter.complete({ scenario: "x", systemPrompt: "s", userPrompt: "u" });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.response_format).toBeUndefined();
  });

  it("returns the message content, model, and provider on success", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ model: "gpt-x", choices: [{ message: { content: '{"ok":true}' } }] })
    );
    const adapter = new OpenRouterAdapter({ apiKey: "k" });

    const res = await adapter.complete({ scenario: "x", systemPrompt: "s", userPrompt: "u" });
    expect(res).toEqual({ content: '{"ok":true}', model: "gpt-x", provider: "openrouter" });
  });

  it("retries on failure and succeeds if a later attempt works", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const adapter = new OpenRouterAdapter({ apiKey: "k" });

    const res = await adapter.complete({ scenario: "x", systemPrompt: "s", userPrompt: "u" });
    expect(res.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 retries (3 total attempts) and throws", async () => {
    fetchMock.mockRejectedValue(new Error("persistent failure"));
    const adapter = new OpenRouterAdapter({ apiKey: "k" });

    await expect(
      adapter.complete({ scenario: "x", systemPrompt: "s", userPrompt: "u" })
    ).rejects.toThrow(/persistent failure/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws (and retries) on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad" }, false, 500));
    const adapter = new OpenRouterAdapter({ apiKey: "k" });

    await expect(
      adapter.complete({ scenario: "x", systemPrompt: "s", userPrompt: "u" })
    ).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the response has no message content", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    const adapter = new OpenRouterAdapter({ apiKey: "k" });

    await expect(
      adapter.complete({ scenario: "x", systemPrompt: "s", userPrompt: "u" })
    ).rejects.toThrow(/message.content/);
  });

  it("aborts a call that exceeds the 30s timeout", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const adapter = new OpenRouterAdapter({ apiKey: "k" });

    const pending = adapter.complete({ scenario: "x", systemPrompt: "s", userPrompt: "u" });
    // Attach the rejection handler before advancing timers — otherwise the
    // promise can reject mid-advance with no handler attached yet, and
    // Node briefly (correctly) flags it as an unhandled rejection.
    const expectation = expect(pending).rejects.toThrow(/aborted/i);
    // Advance past all 3 attempts' 30s timeouts plus backoff delays.
    await vi.advanceTimersByTimeAsync(200_000);

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
