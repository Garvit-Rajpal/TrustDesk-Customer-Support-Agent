// Shared by every thin HTTP adapter in this directory (OpenRouterAdapter,
// EmbeddingHttpAdapter) — same retry/backoff shape, extracted once a second
// call site needed it verbatim rather than speculatively upfront.
export async function withRetries<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt); // 250ms, 500ms
      }
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
