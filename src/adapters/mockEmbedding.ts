// MockEmbeddingAdapter (LLD_v4 §5): default embedding adapter in every
// test — no test ever calls Ollama or a hosted embeddings API. Deterministic
// per input (a seeded LCG keyed off a simple string hash), not a real
// semantic embedding — good enough for similarity-ordering tests to be
// reproducible without needing an actual model.
import type { EmbeddingAdapter } from "./embeddingAdapter.js";

const DIMENSIONS = 768;

function hashSeed(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash || 1; // 0 is a degenerate LCG seed
}

function hashToVector(text: string): number[] {
  let state = hashSeed(text);
  const vector: number[] = [];
  for (let i = 0; i < DIMENSIONS; i++) {
    // Numerical Recipes LCG constants — fine for deterministic test fixtures,
    // not used for anything security-sensitive.
    state = (state * 1664525 + 1013904223) >>> 0;
    vector.push((state / 0xffffffff) * 2 - 1); // [-1, 1]
  }
  return vector;
}

export class MockEmbeddingAdapter implements EmbeddingAdapter {
  async embed(text: string): Promise<number[]> {
    return hashToVector(text);
  }
}
