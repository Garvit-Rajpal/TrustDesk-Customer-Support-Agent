// Requires Node >=22.6.0 (see package.json's engines field): the child
// `node-pg-migrate` process below plain CommonJS require()s each .ts
// migration file directly, with no transpiler in the mix — that only
// resolves because Node 22.6+ strips TypeScript syntax natively before
// executing. On Node 20 this fails with a raw "Unexpected token" syntax
// error instead of a helpful message, since it has no such capability.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const isTest = process.argv.includes("--test");
const databaseUrl = isTest ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(`Missing ${isTest ? "DATABASE_URL_TEST" : "DATABASE_URL"} in environment`);
}

const result = spawnSync(
  "npx",
  ["node-pg-migrate", "up", "-m", "src/db/migrations", "--migration-file-language", "ts"],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  }
);

process.exit(result.status ?? 1);
