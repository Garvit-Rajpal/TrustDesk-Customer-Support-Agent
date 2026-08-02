// Picks the adapter for the configured EMAIL_TIER (LLD_v5 §6, HLD_v5
// ADR-29) — mirrors createEmbeddingAdapter.ts's resolveEmbeddingTier()/
// factory pattern exactly, including the "hosted" tier being inferred ONLY
// from EMAIL_API_KEY, never from OPENAI_API_KEY or EMBEDDINGS_API_KEY — a
// third, distinct credential.
import type { EmailAdapter } from "./emailAdapter.js";
import { EmailHttpAdapter } from "./emailHttp.js";
import { MockEmailAdapter } from "./mockEmail.js";

export type EmailTier = "mock" | "local" | "hosted";

const VALID_TIERS: EmailTier[] = ["mock", "local", "hosted"];

export function resolveEmailTier(env: NodeJS.ProcessEnv = process.env): EmailTier {
  const raw = env.EMAIL_TIER;
  if (raw && (VALID_TIERS as string[]).includes(raw)) {
    return raw as EmailTier;
  }
  return env.EMAIL_API_KEY ? "hosted" : "mock";
}

export function createEmailAdapter(env: NodeJS.ProcessEnv = process.env): EmailAdapter {
  const tier = resolveEmailTier(env);

  switch (tier) {
    // A real transactional email provider (Resend by default) — distinct
    // credential from OPENAI_API_KEY/EMBEDDINGS_API_KEY.
    case "hosted":
      return new EmailHttpAdapter({
        baseUrl: env.EMAIL_BASE_URL ?? "https://api.resend.com",
        apiKey: env.EMAIL_API_KEY ?? "",
        fromAddress: env.EMAIL_FROM_ADDRESS,
      });

    // A local mail catcher (Mailpit by default) — same "no real credential
    // needed for local dev" story MODEL_TIER=local/EMBEDDING_TIER=local
    // already have via Ollama, so a placeholder key is fine.
    case "local":
      return new EmailHttpAdapter({
        baseUrl: env.EMAIL_BASE_URL ?? "http://localhost:8025",
        apiKey: env.EMAIL_API_KEY ?? "mailpit-local",
        fromAddress: env.EMAIL_FROM_ADDRESS,
      });

    case "mock":
    default:
      console.warn(
        "[trustdesk] EMAIL_TIER=mock (or unset with no EMAIL_API_KEY) — running with MockEmailAdapter, magic-link emails are not actually sent."
      );
      return new MockEmailAdapter();
  }
}
