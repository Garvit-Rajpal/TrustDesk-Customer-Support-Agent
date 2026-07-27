import type { ErrorRequestHandler } from "express";

// Last-resort handler for anything a route didn't convert into sendError()
// itself (LLD §4 envelope). Never leaks stack traces to the client.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } });
};
