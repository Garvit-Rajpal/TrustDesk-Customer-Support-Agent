// Thin fetch wrapper over the TrustDesk API. Deliberately loosely typed
// (Record<string, unknown> / any for nested JSON) — HLD §3 calls the
// frontend "simple; JSON panels acceptable; polish not graded", so this
// mirrors backend response shapes by hand rather than sharing types across
// a package boundary that doesn't otherwise exist.
const TOKEN_KEY = "trustdesk_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Request failed: ${res.status}`);
  }
  return json.data as T;
}

export interface LoginResult {
  token: string;
  user: { user_id: string; display_name: string };
}

export interface TicketSummary {
  ticket_id: string;
  customer_id: string;
  order_id: string | null;
  channel: string;
  subject: string;
  body: string;
  status: string;
  created_at: string;
  triage: { category: string; priority: string; sentiment: string; should_escalate: boolean; reason_summary: string } | null;
}

export interface TicketDetail {
  ticket: TicketSummary;
  customer: Record<string, unknown>;
  order: Record<string, unknown> | null;
}

export interface TriageResult {
  ticket_id: string;
  category: string;
  priority: string;
  sentiment: string;
  should_escalate: boolean;
  reason_summary: string;
  run_id: string;
}

export interface RecommendedAction {
  tool_name: string;
  requires_human_approval: boolean;
  reason: string;
}

export interface DraftResult {
  draft_id: string;
  ticket_id: string;
  resolution_type: "answered" | "refused_by_policy" | "escalated";
  body: string;
  citations: string[];
  recommended_actions: RecommendedAction[];
  run_id: string;
}

export interface ToolActionResult {
  action_id: string;
  status: string;
  replayed?: boolean;
  execution_result?: unknown;
}

export interface EvalReport {
  eval_run_id: string;
  started_at: string;
  completed_at: string;
  total_cases: number;
  metrics: {
    triage_accuracy: number;
    citation_coverage: number;
    unsafe_action_block_rate: number;
    escalation_accuracy: number;
  };
  case_results: {
    case_id: string;
    ticket_id: string;
    triage_accuracy: boolean;
    citation_coverage: boolean;
    unsafe_action_block_rate: boolean;
    escalation_accuracy: boolean;
    triage_run_id: string | null;
    draft_run_id: string | null;
  }[];
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResult>("POST", "/auth/login", { username, password }),

  listTickets: () => request<{ tickets: TicketSummary[] }>("GET", "/tickets"),
  getTicket: (id: string) => request<TicketDetail>("GET", `/tickets/${id}`),
  triage: (id: string) => request<TriageResult>("POST", `/tickets/${id}/triage`),
  draftReply: (id: string) => request<DraftResult>("POST", `/tickets/${id}/draft-reply`),

  requestAction: (payload: { ticket_id: string; tool_name: string; payload: Record<string, unknown> }) =>
    request<ToolActionResult>("POST", "/tool-actions", payload),
  approveAction: (actionId: string, reason: string) =>
    request<ToolActionResult>("POST", `/tool-actions/${actionId}/approve`, { reason }),
  rejectAction: (actionId: string, reason: string) =>
    request<ToolActionResult>("POST", `/tool-actions/${actionId}/reject`, { reason }),
  executeAction: (actionId: string) =>
    request<ToolActionResult>("POST", `/tool-actions/${actionId}/execute`),

  runEval: (caseIds?: string[]) =>
    request<EvalReport>("POST", "/eval-runs", caseIds ? { case_ids: caseIds } : {}),

  getAgentRun: (runId: string) => request<Record<string, unknown>>("GET", `/agent-runs/${runId}`),
};
