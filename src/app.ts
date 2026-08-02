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
import { platformRouter } from "./api/routes/platform.js";
import { embeddingsRouter } from "./api/routes/embeddings.js";
import { dashboardRouter } from "./api/routes/dashboard.js";
import { signupRouter } from "./api/routes/signup.js";
import { buildCustomerAuthRouter } from "./api/routes/customerAuth.js";
import { authMiddleware } from "./api/middleware/auth.js";
import { tenancyMiddleware } from "./api/middleware/tenancy.js";
import { errorHandler } from "./api/middleware/errors.js";
import type { ModelAdapter } from "./adapters/modelAdapter.js";
import { MockModelAdapter } from "./adapters/mock.js";
import { DEFAULT_MODEL_SCENARIOS } from "./adapters/defaultMockScenarios.js";
import type { EmbeddingAdapter } from "./adapters/embeddingAdapter.js";
import { MockEmbeddingAdapter } from "./adapters/mockEmbedding.js";
import type { EmailAdapter } from "./adapters/emailAdapter.js";
import { MockEmailAdapter } from "./adapters/mockEmail.js";

// Single source of truth for route wiring, parameterized on the AI adapter
// (ADR-3). server.ts uses this with createModelAdapter() (live OpenRouter
// when configured, mock otherwise); the `app` export below always uses the
// mock, so importing it — as every test does — can never reach OpenRouter
// regardless of a developer's .env (LLD §1 invariant). V4-12 extends this
// same guarantee to embeddings: embeddingAdapter defaults to
// MockEmbeddingAdapter, so every test's resolveTicket() ingestion call
// stays local/in-memory too.
export function buildApp(
  modelAdapter: ModelAdapter,
  embeddingAdapter: EmbeddingAdapter = new MockEmbeddingAdapter(),
  emailAdapter: EmailAdapter = new MockEmailAdapter()
): Express {
  const app = express();

  app.use(express.json());
  app.use("/auth", authRouter);
  // V3-3 (LLD_v3 §2, HLD_v3 ADR-14): public, unauthenticated org-admin
  // signup — mounted at the same tier as /auth, before authMiddleware.
  // No req.user/req.orgContext exists yet; createOrg() never needed one.
  app.use("/signup", signupRouter);
  // W17 (LLD_v4 §7, HLD_v4 ADR-23): public, unauthenticated end-customer
  // ownership verification — same public tier as /signup, before
  // authMiddleware. Issues a CustomerToken, never an agent TokenClaims.
  // V5-19/20 (LLD_v5 §6, HLD_v5 ADR-29): also carries the magic-link
  // request/consume routes, which is why this router now needs an
  // EmailAdapter — defaults to MockEmailAdapter (see buildCustomerAuthRouter)
  // so `export const app` below can never reach a real provider by omission.
  app.use("/customer-auth", buildCustomerAuthRouter(emailAdapter));

  // ADR-4: every route below requires a valid JWT. V2-5: tenancyMiddleware
  // runs right after auth on every one of them, so req.orgContext is always
  // populated before a permission check or handler runs.
  app.use("/tickets", authMiddleware, tenancyMiddleware, buildTicketsRouter(modelAdapter, embeddingAdapter));
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
  // V3-6 (LLD_v3 §4, HLD_v3 ADR-16): tenancyMiddleware still runs (every
  // caller needs a normal req.orgContext to prove who they are / that
  // they're org_default) — the handlers below construct a second, separate
  // OrgContext for the target org they're reading, on purpose.
  app.use("/platform", authMiddleware, tenancyMiddleware, platformRouter);
  // RAG-pipeline visibility: org_default-only, same tenancy shape as
  // /platform above (tenancyMiddleware still runs so req.orgContext is
  // populated to check against, the route itself enforces the narrower
  // org_default restriction).
  app.use("/embeddings", authMiddleware, tenancyMiddleware, embeddingsRouter);
  app.use("/dashboard", authMiddleware, tenancyMiddleware, dashboardRouter);

  app.use(errorHandler);

  return app;
}

export const app = buildApp(new MockModelAdapter(DEFAULT_MODEL_SCENARIOS));
