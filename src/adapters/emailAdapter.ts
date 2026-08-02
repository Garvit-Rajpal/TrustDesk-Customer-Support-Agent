// EmailAdapter (LLD_v5 §6, HLD_v5 ADR-29): mirrors EmbeddingAdapter's shape
// exactly — the only interface that knows about email HTTP APIs, so provider
// swap and test mocking both stay trivial. Kept generic (not magic-link-
// specific) so a future feature (e.g. weekly digest email) can reuse it
// without a new interface.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailAdapter {
  send(message: EmailMessage): Promise<void>;
}
