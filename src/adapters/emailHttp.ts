// EmailHttpAdapter (LLD_v5 §6, HLD_v5 ADR-29): plain fetch, no SDK — same
// reasoning as EmbeddingHttpAdapter/OpenRouterAdapter. One class serves both
// the "local" tier (a Resend-compatible endpoint a developer points at their
// own local mail catcher, e.g. Mailpit, via EMAIL_BASE_URL) and the "hosted"
// tier (Resend's real API, https://api.resend.com) via different
// baseUrl/apiKey constructor parameters — this class never special-cases
// which tier it's serving, exactly like EmbeddingHttpAdapter doesn't. Never
// exercised against a live endpoint in this test suite: MockEmailAdapter is
// the only adapter any test reaches (CLAUDE.md's TDD rule), and this class
// gets its own dedicated unit test against a fully mocked `fetch`.
import type { EmailAdapter, EmailMessage } from "./emailAdapter.js";
import { withRetries } from "./httpRetry.js";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

export interface EmailHttpConfig {
  baseUrl?: string;
  apiKey?: string;
  fromAddress?: string;
}

export class EmailHttpAdapter implements EmailAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fromAddress: string;

  constructor(config: EmailHttpConfig = {}) {
    this.baseUrl = config.baseUrl ?? "http://localhost:8025";
    this.apiKey = config.apiKey ?? "";
    this.fromAddress = config.fromAddress ?? "TrustDesk <no-reply@trustdesk.example>";
    if (!this.apiKey) {
      throw new Error("EmailHttpAdapter requires an API key");
    }
  }

  async send(message: EmailMessage): Promise<void> {
    return withRetries(() => this.sendOnce(message), MAX_RETRIES);
  }

  private async sendOnce(message: EmailMessage): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/emails`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
