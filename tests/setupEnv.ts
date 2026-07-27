import "dotenv/config";

// Tests always run against DATABASE_URL_TEST (LLD §1: "test DB via a
// trustdesk_test Postgres database, truncated between tests"). Force it here
// so a stray DATABASE_URL in .env can never point tests at the dev DB.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST is not set — copy .env.example to .env");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
