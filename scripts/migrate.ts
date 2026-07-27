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
