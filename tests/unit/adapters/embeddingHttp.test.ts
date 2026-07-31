// V4-10 (LLD_v4 §5, HLD_v4 ADR-21): EmbeddingHttpAdapter — OpenAI-compatible
// /embeddings client, same retry/timeout shape as OpenRouterAdapter (both
// now share src/adapters/httpRetry.ts). `fetch` is fully mocked; this suite
// never makes a real network call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingHttpAdapter } from "../../../src/adapters/embeddingHttp.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("EmbeddingHttpAdapter", () => {
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
    expect(() => new EmbeddingHttpAdapter({ apiKey: "" })).toThrow(/API key/);
  });

  it("sends the text as `input`, plus model and Authorization header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    const adapter = new EmbeddingHttpAdapter({ apiKey: "test-key", model: "nomic-embed-text" });

    await adapter.embed("a customer ticket body");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/embeddings$/);
    expect(options.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("nomic-embed-text");
    expect(body.input).toBe("a customer ticket body");
  });

  it("returns data[0].embedding on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [1, 2, 3] }] }));
    const adapter = new EmbeddingHttpAdapter({ apiKey: "k" });

    const result = await adapter.embed("text");
    expect(result).toEqual([1, 2, 3]);
  });

  it("retries on failure and succeeds if a later attempt works", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(jsonResponse({ data: [{ embedding: [1] }] }));
    const adapter = new EmbeddingHttpAdapter({ apiKey: "k" });

    const result = await adapter.embed("text");
    expect(result).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 retries (3 total attempts) and throws", async () => {
    fetchMock.mockRejectedValue(new Error("persistent failure"));
    const adapter = new EmbeddingHttpAdapter({ apiKey: "k" });

    await expect(adapter.embed("text")).rejects.toThrow(/persistent failure/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws (and retries) on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad" }, false, 500));
    const adapter = new EmbeddingHttpAdapter({ apiKey: "k" });

    await expect(adapter.embed("text")).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws when the response has no data[0].embedding", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{}] }));
    const adapter = new EmbeddingHttpAdapter({ apiKey: "k" });

    await expect(adapter.embed("text")).rejects.toThrow(/embedding/);
  });
});
