import "./api/types.js";
import express from "express";
import { authRouter } from "./api/routes/auth.js";
import { errorHandler } from "./api/middleware/errors.js";

export const app = express();

app.use(express.json());
app.use("/auth", authRouter);

// Business routers (tickets, documents, tool-actions, agent-runs, eval-runs)
// land in later milestones (LLD §9) and are mounted here as they're built.

app.use(errorHandler);
