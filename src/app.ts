import "./api/types.js";
import express from "express";
import { authRouter } from "./api/routes/auth.js";
import { ticketsRouter } from "./api/routes/tickets.js";
import { documentsRouter } from "./api/routes/documents.js";
import { authMiddleware } from "./api/middleware/auth.js";
import { errorHandler } from "./api/middleware/errors.js";

export const app = express();

app.use(express.json());
app.use("/auth", authRouter);

// ADR-4: every route below requires a valid JWT.
app.use("/tickets", authMiddleware, ticketsRouter);
app.use("/documents", authMiddleware, documentsRouter);

// Business routers (tool-actions, agent-runs, eval-runs) land in later
// milestones (LLD §9) and are mounted here as they're built.

app.use(errorHandler);
