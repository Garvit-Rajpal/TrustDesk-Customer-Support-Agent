import "dotenv/config";
import { buildApp } from "./app.js";
import { createModelAdapter } from "./adapters/createModelAdapter.js";

const app = buildApp(createModelAdapter());

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`TrustDesk API listening on :${port}`);
});
