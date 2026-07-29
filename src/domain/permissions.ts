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
  // V2-4 (LLD_v2 §5 API table + §3 permission matrix row "resolve/close
  // tickets | agent+"): threads and lifecycle actions are agent+, same tier
  // as triage/draft/tool_actions:request.
  "tickets:messages:view": ["agent", "manager", "admin"],
  "tickets:simulate_inbound": ["agent", "manager", "admin"],
  "drafts:send": ["agent", "manager", "admin"],
  "tickets:resolve": ["agent", "manager", "admin"],
  // V2-5 (LLD_v2 §6 permission matrix row "invite users, onboard orgs |
  // admin"): same tier as users:invite.
  "orgs:create": ["admin"],
  // V2-5 follow-up: POST /customers — same tier as tickets:write, since
  // creating a customer record is a prerequisite step of the same "agent
  // opens a demo ticket" flow (ADR-5), not a separate capability.
  "customers:view": ["agent", "manager", "admin"],
  "customers:write": ["agent", "manager", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function roleHasPermission(role: string, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}
