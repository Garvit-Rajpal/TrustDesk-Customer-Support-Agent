import type { Response } from "express";

// Error envelope + codes (LLD §4): { error: { code, message, details } }.
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "GUARDRAIL_BLOCKED"
  | "TOOL_EXECUTION_FAILED"
  | "MODEL_PROVIDER_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GUARDRAIL_BLOCKED: 422,
  TOOL_EXECUTION_FAILED: 502,
  MODEL_PROVIDER_ERROR: 502,
};

export function sendError(
  res: Response,
  code: ErrorCode,
  message: string,
  details?: unknown
): void {
  res.status(STATUS_BY_CODE[code]).json({ error: { code, message, details } });
}
