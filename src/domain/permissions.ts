// V2-2 (LLD_v2 §3, ADR-9): a single static permission → roles[] map is the
// entire RBAC policy. `requirePermission()` (src/api/middleware/permissions.ts)
// is the only thing that reads this table — no route ever hand-rolls a role
// check, so the table below is a complete, auditable list of who can do what.
import type { Role } from "./authTypes.js";

export const PERMISSIONS = {
  "tickets:view": ["agent", "manager", "admin"],
  "tickets:write": ["agent", "manager", "admin"],
  "tickets:triage": ["agent", "manager", "admin"],
  "tickets:draft": ["agent", "manager", "admin"],
  "tool_actions:request": ["agent", "manager", "admin"],
  "tool_actions:approve": ["manager", "admin"],
  "runs:view": ["agent", "manager", "admin"],
  "runs:view_rejected_output": ["manager", "admin"],
  "documents:view": ["agent", "manager", "admin"],
  "documents:ingest": ["admin"],
  "eval_runs:run": ["admin"],
  "users:invite": ["admin"],
  "feedback:submit": ["agent", "manager", "admin"],
  "metrics:view": ["manager", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(role: string, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}
