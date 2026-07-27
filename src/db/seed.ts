// Seed loader (LLD §9 milestone 1). Reads the copied seed data files under
// Solution/data/ (never the requirements repo — this repo must stand alone)
// and loads them via the repos. Re-runnable: every write is an upsert.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import bcrypt from "bcrypt";

import { Customer, Order, SeedTicket, KbDocumentInput, ToolCatalogEntry } from "../domain/entities.js";
import { newUserId } from "../domain/ids.js";
import { upsertCustomer } from "./repos/customersRepo.js";
import { upsertOrder } from "./repos/ordersRepo.js";
import { upsertSeedTicket } from "./repos/ticketsRepo.js";
import { upsertExpectedLabels } from "./repos/expectedLabelsRepo.js";
import { upsertKbDocument } from "./repos/kbDocumentsRepo.js";
import { upsertToolCatalogEntry } from "./repos/toolCatalogRepo.js";
import { getUserByUsername, upsertUser } from "./repos/usersRepo.js";
import { pool } from "./pool.js";

// No user seed data was provided by the requirements repo. Per ADR-4
// ("accounts exist only via the seed script or env-configured bootstrap
// credentials"), demo accounts are defined here; passwords are overridable
// via env vars so a deployed instance isn't stuck with the documented
// defaults (see docs/PROGRESS.md).
const DEMO_USERS = [
  {
    username: "agent1",
    password: process.env.SEED_AGENT_PASSWORD ?? "agent123",
    display_name: "Priya Nair",
    role: "agent",
  },
  {
    username: "manager1",
    password: process.env.SEED_MANAGER_PASSWORD ?? "manager123",
    display_name: "Rohan Gupta",
    role: "manager",
  },
] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

export interface SeedSummary {
  customers: number;
  orders: number;
  tickets: number;
  kbDocuments: number;
  toolCatalog: number;
  users: number;
}

async function seedUsers(): Promise<number> {
  for (const demo of DEMO_USERS) {
    const existing = await getUserByUsername(demo.username);
    const password_hash = await bcrypt.hash(demo.password, 10);
    await upsertUser({
      user_id: existing?.user_id ?? newUserId(),
      username: demo.username,
      password_hash,
      display_name: demo.display_name,
      role: demo.role,
    });
  }
  return DEMO_USERS.length;
}

async function readJson<T>(file: string): Promise<T> {
  const raw = await readFile(path.join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw) as T;
}

// KB markdown files follow a fixed header shape (see data/knowledge_base/*.md):
//   # Title
//   Doc ID: KB-XXX-001
//   Audience: ...
//   Version: 2026.07
function parseKbMarkdown(content: string, sourcePath: string): KbDocumentInput {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const docIdMatch = content.match(/^Doc ID:\s*(.+)$/m);
  const audienceMatch = content.match(/^Audience:\s*(.+)$/m);
  const versionMatch = content.match(/^Version:\s*(.+)$/m);

  if (!titleMatch || !docIdMatch) {
    throw new Error(`KB doc ${sourcePath} missing required "# Title" or "Doc ID:" header`);
  }

  return KbDocumentInput.parse({
    doc_id: docIdMatch[1]!.trim(),
    title: titleMatch[1]!.trim(),
    content,
    source_path: sourcePath,
    version: versionMatch?.[1]?.trim(),
    audience: audienceMatch?.[1]?.trim(),
  });
}

export async function runSeed(): Promise<SeedSummary> {
  const customers = (await readJson<unknown[]>("customers.json")).map((c) => Customer.parse(c));
  const orders = (await readJson<unknown[]>("orders.json")).map((o) => Order.parse(o));
  const tickets = (await readJson<unknown[]>("tickets.json")).map((t) => SeedTicket.parse(t));
  const toolCatalog = (await readJson<unknown[]>("tool_actions.json")).map((t) =>
    ToolCatalogEntry.parse(t)
  );

  const kbDir = path.join(DATA_DIR, "knowledge_base");
  const kbFiles = (await readdir(kbDir)).filter((f) => f.endsWith(".md"));
  const kbDocuments = await Promise.all(
    kbFiles.map(async (file) => {
      const content = await readFile(path.join(kbDir, file), "utf-8");
      return parseKbMarkdown(content, `data/knowledge_base/${file}`);
    })
  );

  for (const customer of customers) await upsertCustomer(customer);
  for (const order of orders) await upsertOrder(order);
  for (const ticket of tickets) {
    await upsertSeedTicket(ticket);
    await upsertExpectedLabels(ticket);
  }
  for (const doc of kbDocuments) await upsertKbDocument(doc);
  for (const tool of toolCatalog) await upsertToolCatalogEntry(tool);
  const users = await seedUsers();

  return {
    customers: customers.length,
    orders: orders.length,
    tickets: tickets.length,
    kbDocuments: kbDocuments.length,
    toolCatalog: toolCatalog.length,
    users,
  };
}

async function main(): Promise<void> {
  const summary = await runSeed();
  console.log("Seed complete:", summary);
  await pool.end();
}

// Only run when executed directly (`npm run seed`), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
