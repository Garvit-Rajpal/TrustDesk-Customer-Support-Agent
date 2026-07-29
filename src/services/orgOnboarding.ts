// OrgOnboardingService (LLD_v2 §6): "POST /orgs (admin) { name, vertical }
// -> creates org + stamps the vertical's policy pack (doc IDs prefixed
// '{ORG}-') + creates the org's first admin invite." Reuses the same
// KB-markdown header parser convention as the seed loader
// (data/knowledge_base/*.md and src/policy_packs/{vertical}/*.md share the
// "# Title / Doc ID: / Audience: / Version:" header shape).
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import bcrypt from "bcrypt";

import { KbDocumentInput, Org } from "../domain/entities.js";
import type { CreateOrgRequest } from "../domain/orgTypes.js";
import type { Vertical } from "../domain/schemas.js";
import { newOrgId, newUserId } from "../domain/ids.js";
import { insertOrg, slugExists } from "../db/repos/orgsRepo.js";
import { upsertKbDocument } from "../db/repos/kbDocumentsRepo.js";
import { getUserByUsername, insertUser } from "../db/repos/usersRepo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = path.resolve(__dirname, "../policy_packs");

function parsePackMarkdown(content: string, sourcePath: string): KbDocumentInput {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const docIdMatch = content.match(/^Doc ID:\s*(.+)$/m);
  const audienceMatch = content.match(/^Audience:\s*(.+)$/m);
  const versionMatch = content.match(/^Version:\s*(.+)$/m);

  if (!titleMatch || !docIdMatch) {
    throw new Error(`Policy pack doc ${sourcePath} missing required "# Title" or "Doc ID:" header`);
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

// Human-readable, unique identifier derived from the org name — used to
// prefix stamped policy-pack doc IDs instead of the opaque org_id nanoid
// (e.g. "Acme Software" -> "ACME-SOFTWARE-KB-REFUND-001", not
// "org_AbC123xyz-KB-REFUND-001"). Falls back to appending a short numeric
// suffix on a collision (two orgs named the same thing, or one whose slugified
// name coincides with another's) so orgs.slug's UNIQUE constraint never 500s.
function slugify(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? base : "ORG";
}

async function deriveUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!(await slugExists(base))) return base;
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!(await slugExists(candidate))) return candidate;
  }
  throw new Error(`Could not derive a unique slug for org name "${name}"`);
}

// LLD_v2 §6: "kb doc IDs remain globally unique because pack stamping
// prefixes them ('{ORG}-KB-REFUND-001')". Prefix is the new org's slug.
export async function stampPolicyPack(orgId: string, slug: string, vertical: Vertical): Promise<string[]> {
  const dir = path.join(PACKS_DIR, vertical);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));

  const documentIds: string[] = [];
  for (const file of files) {
    const content = await readFile(path.join(dir, file), "utf-8");
    const doc = parsePackMarkdown(content, `src/policy_packs/${vertical}/${file}`);
    const stampedId = `${slug}-${doc.doc_id}`;
    await upsertKbDocument({ ...doc, doc_id: stampedId }, orgId);
    documentIds.push(stampedId);
  }
  return documentIds;
}

export type CreateOrgOutcome =
  | { kind: "username_taken" }
  | { kind: "ok"; org: Org; admin_user_id: string; document_ids: string[] };

export async function createOrg(input: CreateOrgRequest): Promise<CreateOrgOutcome> {
  const existing = await getUserByUsername(input.admin_username);
  if (existing) {
    return { kind: "username_taken" };
  }

  const orgId = newOrgId();
  const slug = await deriveUniqueSlug(input.name);
  const org = await insertOrg({ org_id: orgId, name: input.name, slug, vertical: input.vertical });
  const documentIds = await stampPolicyPack(orgId, slug, input.vertical);

  const adminUserId = newUserId();
  const passwordHash = await bcrypt.hash(input.admin_password, 10);
  await insertUser(
    { org_id: orgId },
    {
      user_id: adminUserId,
      username: input.admin_username,
      password_hash: passwordHash,
      display_name: input.admin_display_name,
      role: "admin",
    }
  );

  return { kind: "ok", org, admin_user_id: adminUserId, document_ids: documentIds };
}
