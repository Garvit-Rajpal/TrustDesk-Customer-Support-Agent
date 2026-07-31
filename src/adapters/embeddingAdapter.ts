// EmbeddingAdapter (HLD_v4 ADR-21, LLD_v4 §5): mirrors ModelAdapter's shape
// exactly — the only interface that knows about embedding HTTP APIs, so
// provider swap and test mocking both stay trivial, same as ModelAdapter.
export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
}
