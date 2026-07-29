// TicketStatus state machine (LLD_v2 §5). Pure lookup table — the single
// source of truth for which transitions are legal; every caller (triage's
// auto-advance, simulate-inbound, drafts/:id/send, resolve, close) goes
// through canTransition() rather than hand-rolling its own status checks.
import type { TicketStatus } from "../domain/schemas.js";

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress"],
  in_progress: ["awaiting_customer", "resolved"],
  awaiting_customer: ["customer_replied", "resolved"],
  customer_replied: ["in_progress"],
  resolved: ["closed", "customer_replied"],
  closed: [],
};

export function canTransition(from: string, to: TicketStatus): boolean {
  const allowed = TRANSITIONS[from as TicketStatus] as TicketStatus[] | undefined;
  return allowed !== undefined && allowed.includes(to);
}
