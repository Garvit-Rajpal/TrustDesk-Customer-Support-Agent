// MockEmailAdapter (LLD_v5 §6): default email adapter in every test — no
// test ever calls Mailpit or a hosted email API. Every send() call pushes
// the message onto a public `sent` array and resolves immediately, never
// touching the network — mandatory in every test per CLAUDE.md's TDD rule
// (same rule MockModelAdapter/MockEmbeddingAdapter already follow).
import type { EmailAdapter, EmailMessage } from "./emailAdapter.js";

export class MockEmailAdapter implements EmailAdapter {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}
