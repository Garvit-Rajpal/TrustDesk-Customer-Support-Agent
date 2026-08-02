import "dotenv/config";
import http from "node:http";
import { buildApp } from "./app.js";
import { createModelAdapter } from "./adapters/createModelAdapter.js";
import { createEmbeddingAdapter } from "./adapters/createEmbeddingAdapter.js";
import { createEmailAdapter } from "./adapters/createEmailAdapter.js";
import { attachCustomerChatServer } from "./ws/customerChatServer.js";

const modelAdapter = createModelAdapter();
const embeddingAdapter = createEmbeddingAdapter();
const emailAdapter = createEmailAdapter();
const app = buildApp(modelAdapter, embeddingAdapter, emailAdapter);

// W17 (LLD_v4 §7): WS attachment needs the raw http.Server, which only this
// file constructs — app.ts/the exported `app` every test imports stays
// HTTP-only.
const httpServer = http.createServer(app);
attachCustomerChatServer(httpServer, modelAdapter, embeddingAdapter);

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  console.log(`TrustDesk API listening on :${port}`);
});
