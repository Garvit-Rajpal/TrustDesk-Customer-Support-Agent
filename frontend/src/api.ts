// Thin fetch wrapper over the TrustDesk API. Deliberately loosely typed
// (Record<string, unknown> / any for nested JSON) — HLD §3 calls the
// frontend "simple; JSON panels acceptable; polish not graded", so this
// mirrors backend response shapes by hand rather than sharing types across
// a package boundary that doesn't otherwise exist.
const TOKEN_KEY = "trustdesk_token";
const ROLE_KEY = "trustdesk_role";
const ORG_ID_KEY = "trustdesk_org_id";
const ORG_NAME_KEY = "trustdesk_org_name";
const WELCOME_SEEN_KEY = "trustdesk_welcome_seen_at";

export type Role = "agent" | "manager" | "admin";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// V2-2 (LLD_v2 §3): the frontend's only source of "what can this user do" —
// mirrors the JWT's role claim so nav/buttons can gate without a round
// trip. The backend's requirePermission() is the actual enforcement; this
// is UI convenience only, never trusted for anything security-relevant.
export function getRole(): Role | null {
  return localStorage.getItem(ROLE_KEY) as Role | null;
}
export function setRole(role: Role): void {
  localStorage.setItem(ROLE_KEY, role);
}
export function clearRole(): void {
  localStorage.removeItem(ROLE_KEY);
}

// V2-5 (LLD_v2 §6/§8): "topbar (org name, user, logout)" — mirrors the
// login response's org, same persist-across-reload pattern as role above.
export function getOrgId(): string | null {
  return localStorage.getItem(ORG_ID_KEY);
}
export function getOrgName(): string | null {
  return localStorage.getItem(ORG_NAME_KEY);
}
export function setOrg(orgId: string, orgName: string): void {
  localStorage.setItem(ORG_ID_KEY, orgId);
  localStorage.setItem(ORG_NAME_KEY, orgName);
}
export function clearOrg(): void {
  localStorage.removeItem(ORG_ID_KEY);
  localStorage.removeItem(ORG_NAME_KEY);
}

// V3-7 (LLD_v3 §5): mirrors role/org's persist-across-reload pattern so the
// welcome banner doesn't reappear on every hard refresh.
export function getWelcomeSeenAt(): string | null {
  return localStorage.getItem(WELCOME_SEEN_KEY);
}
export function setWelcomeSeenAt(value: string | null): void {
  if (value) localStorage.setItem(WELCOME_SEEN_KEY, value);
  else localStorage.removeItem(WELCOME_SEEN_KEY);
}
export function clearWelcomeSeenAt(): void {
  localStorage.removeItem(WELCOME_SEEN_KEY);
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

export interface SessionUser {
  user_id: string;
  display_name: string;
  role: Role;
  org_id: string;
  // V3-7 (LLD_v3 §5): null until the frontend calls markWelcomeSeen once.
  welcome_seen_at: string | null;
}

export interface LoginResult {
  token: string;
  user: SessionUser;
  // V2-5 (LLD_v2 §6): "login response includes org."
  org: { org_id: string; name: string; slug: string };
}

// V2-5 (LLD_v2 §1/§6).
export type Vertical = "retail_ecommerce" | "software" | "finance";

export interface Org {
  org_id: string;
  name: string;
  slug: string;
  vertical: Vertical;
  created_at: string;
}

export interface CreateOrgInput {
  name: string;
  vertical: Vertical;
  admin_username: string;
  admin_password: string;
  admin_display_name: string;
}

export interface CreateOrgResult {
  org: Org;
  admin_user_id: string;
  document_ids: string[];
  customer_ids: string[];
}

// V3-3 (LLD_v3 §2, HLD_v3 ADR-14): the signer picks their own admin
// credentials — same shape as CreateOrgInput.
export type SignupInput = CreateOrgInput;

export interface SignupResult {
  token: string;
  user: SessionUser;
  org: { org_id: string; name: string; slug: string };
  document_ids: string[];
  customer_ids: string[];
}

// V2-5 follow-up: POST /customers — a freshly onboarded org starts with
// zero customers, and without this couldn't create a ticket either.
export interface Customer {
  customer_id: string;
  name: string;
  email: string;
  tier: string;
  country: string;
  verified: boolean;
  tags: string[];
  created_at: string;
}

export interface CreateCustomerInput {
  name: string;
  email: string;
  country: string;
  tier?: string;
  verified?: boolean;
  tags?: string[];
}

export interface CreateTicketInput {
  customer_id: string;
  order_id?: string;
  channel: string;
  subject: string;
  body: string;
}

export interface InviteUserInput {
  username: string;
  password: string;
  display_name: string;
  role?: Role;
}

export interface InviteUserResult {
  user_id: string;
  username: string;
  display_name: string;
  role: Role;
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
  // V3-4 (LLD_v3 §3, HLD_v3 ADR-15): one-way human takeover flag.
  human_owned: boolean;
  human_owned_by: string | null;
  human_owned_at: string | null;
}

// V3-5 (LLD_v3 §3, HLD_v3 ADR-15): POST /tickets now returns the ticket plus
// the auto-pipeline's best-effort outcome.
export interface CreateTicketResult extends TicketSummary {
  pipeline: { triage: boolean; draft: boolean; auto_sent: boolean };
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
  // V3-5 (LLD_v3 §3, HLD_v3 ADR-15).
  auto_sent: boolean;
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

export interface GuardrailCheckResult {
  layer: "input_scan" | "prompt_structure" | "output_scan";
  check: string;
  passed: boolean;
  detail?: string;
}

export interface AgentRunTrace {
  run_id: string;
  ticket_id: string | null;
  run_type: string;
  status: "completed" | "guardrail_blocked" | "failed";
  retrieved_doc_ids: string[];
  tool_calls: unknown[];
  guardrail_results: GuardrailCheckResult[];
  rejected_output: unknown;
  model_provider: string | null;
  model_name: string | null;
  latency_ms: number | null;
  created_at: string;
}

// GET /documents and GET /documents/:docId return the same shape (both
// include full content — kbDocumentsRepo doesn't have a lighter summary
// projection).
export interface KbDocument {
  doc_id: string;
  title: string;
  content: string;
  source_path: string;
  version: string;
  audience: string;
}

export interface DocumentSearchResult {
  doc_id: string;
  title: string;
  snippet: string;
  score: number;
  audience: string;
}

export interface IngestDocumentInput {
  doc_id: string;
  title: string;
  content: string;
  // Provenance metadata, not a real file path — optional; the backend
  // fills in a synthetic one when omitted (see POST /documents/ingest).
  source_path?: string;
  version?: string;
  audience?: string;
}

export interface SubmitFeedbackInput {
  rating: number;
  reason?: string;
  corrected_response?: string;
}

export interface FeedbackResult {
  feedback_id: string;
  ticket_id: string;
  draft_id: string;
  reviewer_id: string;
  rating: number;
  reason: string | null;
  corrected_response: string | null;
  created_at: string;
}

export interface CategoryMetrics {
  draft_acceptance_rate: number | null;
  action_approval_rate: number | null;
  avg_rating: number | null;
  guardrail_block_rate: number | null;
}

export interface QualityReport extends CategoryMetrics {
  by_category: Record<string, CategoryMetrics>;
}

// V2-4 (LLD_v2 §5). V3-4: human_owned drafts have draft_id: null and author
// set to the human agent's user_id instead of "system"/a draft's author id.
export interface TicketMessage {
  message_id: string;
  ticket_id: string;
  direction: "inbound" | "outbound";
  body: string;
  author: string;
  draft_id: string | null;
  created_at: string;
}

// V3-6 (LLD_v3 §4, HLD_v3 ADR-16).
export interface ConsentFlags {
  allow_platform_support: boolean;
  allow_platform_metrics: boolean;
}

// V3-7 (LLD_v3 §5, HLD_v3 ADR-17).
export interface DashboardSummary {
  tickets_by_status: Record<string, number>;
  quality: QualityReport;
  eval_summary:
    | { available: false }
    | { available: true; eval_run_id: string; completed_at: string | null; metrics: Record<string, number> };
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResult>("POST", "/auth/login", { username, password }),

  listTickets: () => request<{ tickets: TicketSummary[] }>("GET", "/tickets"),
  getTicket: (id: string) => request<TicketDetail>("GET", `/tickets/${id}`),
  createTicket: (input: CreateTicketInput) => request<CreateTicketResult>("POST", "/tickets", input),
  triage: (id: string) => request<TriageResult>("POST", `/tickets/${id}/triage`),
  draftReply: (id: string) => request<DraftResult>("POST", `/tickets/${id}/draft-reply`),

  listCustomers: () => request<{ customers: Customer[] }>("GET", "/customers"),
  createCustomer: (input: CreateCustomerInput) => request<Customer>("POST", "/customers", input),

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

  getAgentRun: (runId: string) => request<AgentRunTrace>("GET", `/agent-runs/${runId}`),

  listDocuments: () => request<{ documents: KbDocument[] }>("GET", "/documents"),
  getDocument: (docId: string) => request<KbDocument>("GET", `/documents/${docId}`),
  searchDocuments: (q: string, category?: string) =>
    request<{ query: string; results: DocumentSearchResult[] }>(
      "GET",
      `/documents/search?${new URLSearchParams({ q, ...(category ? { category } : {}) })}`
    ),
  ingestDocuments: (documents: IngestDocumentInput[]) =>
    request<{ ingested: number; document_ids: string[] }>("POST", "/documents/ingest", { documents }),

  inviteUser: (input: InviteUserInput) => request<InviteUserResult>("POST", "/users/invite", input),

  submitFeedback: (draftId: string, input: SubmitFeedbackInput) =>
    request<FeedbackResult>("POST", `/drafts/${draftId}/feedback`, input),
  getAgentQuality: () => request<QualityReport>("GET", "/metrics/agent-quality"),

  getMessages: (ticketId: string) =>
    request<{ messages: TicketMessage[] }>("GET", `/tickets/${ticketId}/messages`),
  simulateInbound: (ticketId: string, body: string) =>
    request<TicketMessage>("POST", `/tickets/${ticketId}/messages/simulate-inbound`, { body }),
  sendDraft: (draftId: string) =>
    request<{ draft_id: string; ticket_id: string; message: TicketMessage }>(
      "POST",
      `/drafts/${draftId}/send`
    ),
  resolveTicket: (ticketId: string) =>
    request<{ ticket_id: string; status: string }>("POST", `/tickets/${ticketId}/resolve`),
  closeTicket: (ticketId: string) =>
    request<{ ticket_id: string; status: string }>("POST", `/tickets/${ticketId}/close`),

  createOrg: (input: CreateOrgInput) => request<CreateOrgResult>("POST", "/orgs", input),

  // V3-3 (LLD_v3 §2, HLD_v3 ADR-14): public, unauthenticated.
  signup: (input: SignupInput) => request<SignupResult>("POST", "/signup", input),

  // V3-4 (LLD_v3 §3, HLD_v3 ADR-15): human takeover — bypasses the draft
  // pipeline entirely.
  sendManualReply: (ticketId: string, body: string) =>
    request<TicketMessage>("POST", `/tickets/${ticketId}/messages/reply`, { body }),

  // V3-6 (LLD_v3 §4, HLD_v3 ADR-16).
  getConsent: () => request<ConsentFlags>("GET", "/orgs/consent"),
  updateConsent: (patch: Partial<ConsentFlags>) => request<ConsentFlags>("PUT", "/orgs/consent", patch),
  platformTickets: (targetOrgId: string) =>
    request<{ tickets: TicketSummary[] }>("GET", `/platform/tickets?target_org_id=${encodeURIComponent(targetOrgId)}`),
  platformTicketMessages: (targetOrgId: string, ticketId: string) =>
    request<{ messages: TicketMessage[] }>(
      "GET",
      `/platform/tickets/${ticketId}/messages?target_org_id=${encodeURIComponent(targetOrgId)}`
    ),
  platformMetrics: (targetOrgId: string) =>
    request<QualityReport>("GET", `/platform/metrics?target_org_id=${encodeURIComponent(targetOrgId)}`),

  // V3-7 (LLD_v3 §5, HLD_v3 ADR-17).
  getDashboardSummary: () => request<DashboardSummary>("GET", "/dashboard/summary"),
  markWelcomeSeen: () => request<{ welcome_seen_at: string }>("POST", "/users/me/welcome-seen"),
};
