// Entity-shaped zod schemas for seed data and repositories (LLD §2 DDL / §3).
// These validate the raw seed JSON at load time and give repos typed rows.
import { z } from "zod";
import { Category, Priority, Sentiment } from "./schemas.js";

export const Customer = z.object({
  customer_id: z.string(),
  name: z.string(),
  email: z.string(),
  tier: z.string(),
  country: z.string(),
  verified: z.boolean(),
  tags: z.array(z.string()).default([]),
  created_at: z.string(),
});
export type Customer = z.infer<typeof Customer>;

export const OrderItem = z.object({
  sku: z.string(),
  name: z.string(),
  quantity: z.number(),
  category: z.string(),
  final_sale: z.boolean(),
});
export type OrderItem = z.infer<typeof OrderItem>;

export const Order = z.object({
  order_id: z.string(),
  customer_id: z.string(),
  status: z.string(),
  placed_at: z.string(),
  delivered_at: z.string().nullable(),
  eligible_return_until: z.string().nullable(),
  total: z.number(),
  currency: z.string(),
  payment_status: z.string(),
  tracking_number: z.string().nullable(),
  items: z.array(OrderItem),
});
export type Order = z.infer<typeof Order>;

// Seed data (tkt_9004) uses "worried" as expected_sentiment, which predates
// the LLD's Sentiment enum (calm|frustrated|angry|anxious|neutral). Resolved
// with the project owner: normalize to "anxious" (closest match — tkt_9004
// is a swollen-battery safety concern) rather than expand the enum, since
// LLD's enum is the single source of truth (CLAUDE.md conventions).
const expectedSentimentAliases: Record<string, string> = { worried: "anxious" };
const NormalizedSentiment = z.preprocess(
  (val) => (typeof val === "string" ? (expectedSentimentAliases[val] ?? val) : val),
  Sentiment
);

// Raw seed ticket — includes expected_* labels, which the seed loader peels
// off into ticket_expected_labels (LLD §2, HLD invariant #4). Never used as
// the runtime ticket shape.
export const SeedTicket = z.object({
  ticket_id: z.string(),
  customer_id: z.string(),
  order_id: z.string().nullable(),
  channel: z.string(),
  subject: z.string(),
  body: z.string(),
  created_at: z.string(),
  status: z.string(),
  expected_category: Category.optional(),
  expected_priority: Priority.optional(),
  expected_sentiment: NormalizedSentiment.optional(),
  expected_escalation: z.boolean().optional(),
  expected_actions: z.array(z.string()).optional(),
});
export type SeedTicket = z.infer<typeof SeedTicket>;

// Runtime ticket row — no expected_* fields. This is what every service
// other than the seed loader / EvalRunner is allowed to see (HLD invariant #4).
export const Ticket = z.object({
  ticket_id: z.string(),
  customer_id: z.string(),
  order_id: z.string().nullable(),
  channel: z.string(),
  subject: z.string(),
  body: z.string(),
  status: z.string(),
  created_at: z.string(),
  triage: z.unknown().nullable(),
});
export type Ticket = z.infer<typeof Ticket>;

export const KbDocumentInput = z.object({
  doc_id: z.string(),
  title: z.string(),
  content: z.string(),
  source_path: z.string(),
  version: z.string().optional().default("unversioned"),
  audience: z.string().optional().default("Customer support agents"),
});
export type KbDocumentInput = z.infer<typeof KbDocumentInput>;

export const ToolCatalogEntry = z.object({
  tool_name: z.string(),
  description: z.string(),
  risk_level: z.string(),
  requires_human_approval: z.boolean(),
  allowed_categories: z.array(z.string()),
  required_fields: z.array(z.string()),
  max_amount_inr: z.number().nullable().optional(),
});
export type ToolCatalogEntry = z.infer<typeof ToolCatalogEntry>;
