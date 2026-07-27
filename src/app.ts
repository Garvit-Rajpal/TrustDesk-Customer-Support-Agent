import "./api/types.js";
import express from "express";
import { authRouter } from "./api/routes/auth.js";
import { buildTicketsRouter } from "./api/routes/tickets.js";
import { documentsRouter } from "./api/routes/documents.js";
import { agentRunsRouter } from "./api/routes/agentRuns.js";
import { authMiddleware } from "./api/middleware/auth.js";
import { errorHandler } from "./api/middleware/errors.js";
import { MockModelAdapter } from "./adapters/mock.js";
import { DEFAULT_TRIAGE_SCENARIOS } from "./adapters/defaultMockScenarios.js";

export const app = express();

// Default AI adapter for the running app until OpenRouterAdapter lands
// (milestone 9, ADR-3). Swapping to the live adapter is a one-line change
// here — nothing else in the app imports an AI HTTP client.
const defaultModelAdapter = new MockModelAdapter(DEFAULT_TRIAGE_SCENARIOS);

app.use(express.json());
app.use("/auth", authRouter);

// ADR-4: every route below requires a valid JWT.
app.use("/tickets", authMiddleware, buildTicketsRouter(defaultModelAdapter));
app.use("/documents", authMiddleware, documentsRouter);
app.use("/agent-runs", authMiddleware, agentRunsRouter);

// Business routers (tool-actions, eval-runs) land in later milestones
// (LLD §9) and are mounted here as they're built.

app.use(errorHandler);
