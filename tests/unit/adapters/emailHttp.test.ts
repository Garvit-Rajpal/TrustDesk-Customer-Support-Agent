// V5-16 (LLD_v5 §6, HLD_v5 ADR-29): EmailHttpAdapter — same retry/timeout
// shape as EmbeddingHttpAdapter (both share src/adapters/httpRetry.ts).
// `fetch` is fully mocked; this suite never makes a real network call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailHttpAdapter } from "../../../src/adapters/emailHttp.js";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("EmailHttpAdapter", () => {
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
    expect(() => new EmailHttpAdapter({ apiKey: "" })).toThrow(/API key/);
  });

  it("sends to/subject/text/html, plus from and Authorization header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "email_1" }));
    const adapter = new EmailHttpAdapter({ apiKey: "test-key", fromAddress: "TrustDesk <no-reply@trustdesk.example>" });

    await adapter.send({ to: "customer@example.com", subject: "Your link", text: "click here", html: "<p>click</p>" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/emails$/);
    expect(options.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(options.body);
    expect(body.from).toBe("TrustDesk <no-reply@trustdesk.example>");
    expect(body.to).toBe("customer@example.com");
    expect(body.subject).toBe("Your link");
    expect(body.text).toBe("click here");
    expect(body.html).toBe("<p>click</p>");
  });

  it("resolves without a return value on success", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "email_1" }));
    const adapter = new EmailHttpAdapter({ apiKey: "k" });

    await expect(adapter.send({ to: "a@example.com", subject: "s", text: "t" })).resolves.toBeUndefined();
  });

  it("retries on failure and succeeds if a later attempt works", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network blip")).mockResolvedValueOnce(jsonResponse({ id: "e" }));
    const adapter = new EmailHttpAdapter({ apiKey: "k" });

    await adapter.send({ to: "a@example.com", subject: "s", text: "t" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 retries (3 total attempts) and throws", async () => {
    fetchMock.mockRejectedValue(new Error("persistent failure"));
    const adapter = new EmailHttpAdapter({ apiKey: "k" });

    await expect(adapter.send({ to: "a@example.com", subject: "s", text: "t" })).rejects.toThrow(/persistent failure/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws (and retries) on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad" }, false, 500));
    const adapter = new EmailHttpAdapter({ apiKey: "k" });

    await expect(adapter.send({ to: "a@example.com", subject: "s", text: "t" })).rejects.toThrow(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
