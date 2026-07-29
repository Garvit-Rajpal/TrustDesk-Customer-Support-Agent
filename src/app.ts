import "./api/types.js";
import express, { type Express } from "express";
import { authRouter } from "./api/routes/auth.js";
import { buildTicketsRouter } from "./api/routes/tickets.js";
import { documentsRouter } from "./api/routes/documents.js";
import { agentRunsRouter } from "./api/routes/agentRuns.js";
import { toolActionsRouter } from "./api/routes/toolActions.js";
import { buildEvalRunsRouter } from "./api/routes/evalRuns.js";
import { usersRouter } from "./api/routes/users.js";
import { draftsRouter } from "./api/routes/drafts.js";
import { metricsRouter } from "./api/routes/metrics.js";
import { orgsRouter } from "./api/routes/orgs.js";
import { customersRouter } from "./api/routes/customers.js";
import { authMiddleware } from "./api/middleware/auth.js";
import { tenancyMiddleware } from "./api/middleware/tenancy.js";
import { errorHandler } from "./api/middleware/errors.js";
import type { ModelAdapter } from "./adapters/modelAdapter.js";
import { MockModelAdapter } from "./adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "./adapters/defaultMockScenarios.js";

// Single source of truth for route wiring, parameterized on the AI adapter
// (ADR-3). server.ts uses this with createModelAdapter() (live OpenRouter
// when configured, mock otherwise); the `app` export below always uses the
// mock, so importing it — as every test does — can never reach OpenRouter
// regardless of a developer's .env (LLD §1 invariant).
export function buildApp(modelAdapter: ModelAdapter): Express {
  const app = express();

  app.use(express.json());
  app.use("/auth", authRouter);

  // ADR-4: every route below requires a valid JWT. V2-5: tenancyMiddleware
  // runs right after auth on every one of them, so req.orgContext is always
  // populated before a permission check or handler runs.
  app.use("/tickets", authMiddleware, tenancyMiddleware, buildTicketsRouter(modelAdapter));
  app.use("/documents", authMiddleware, tenancyMiddleware, documentsRouter);
  app.use("/agent-runs", authMiddleware, tenancyMiddleware, agentRunsRouter);
  app.use("/tool-actions", authMiddleware, tenancyMiddleware, toolActionsRouter);
  app.use("/eval-runs", authMiddleware, tenancyMiddleware, buildEvalRunsRouter(modelAdapter));
  app.use("/users", authMiddleware, tenancyMiddleware, usersRouter);
  app.use("/drafts", authMiddleware, tenancyMiddleware, draftsRouter);
  app.use("/metrics", authMiddleware, tenancyMiddleware, metricsRouter);
  app.use("/customers", authMiddleware, tenancyMiddleware, customersRouter);
  // POST /orgs creates a NEW tenant — it doesn't read/write the caller's own
  // org's data, but tenancyMiddleware is harmless to include here too (its
  // req.orgContext is simply unused by the handler) and keeps every
  // authenticated route uniform.
  app.use("/orgs", authMiddleware, tenancyMiddleware, orgsRouter);

  app.use(errorHandler);

  return app;
}

export const app = buildApp(new MockModelAdapter(DEFAULT_MODEL_SCENARIOS));
