// Thin fetch wrapper over the TrustDesk API. Types mirror backend response
// shapes by hand rather than sharing types across a package boundary that
// doesn't otherwise exist. V1-v3's "JSON panels acceptable, polish not
// graded" allowance for customer/order rendering is superseded by V4-4
// (LLD_v4 §3, HLD_v4 ADR-19) — those two now have typed shapes and real
// card components instead of a raw JSON dump.
const TOKEN_KEY = "trustdesk_token";
const ROLE_KEY = "trustdesk_role";
const ORG_ID_KEY = "trustdesk_org_id";
const ORG_NAME_KEY = "trustdesk_org_name";
const WELCOME_SEEN_KEY = "trustdesk_welcome_seen_at";
// W17 (LLD_v4 §7): deliberately separate keys from the agent token above —
// a customer_token carries no `role` and must never be sent on an
// agent/admin route (or vice versa); keeping them in different storage
// slots means a browser tab can't accidentally mix the two up.
const CUSTOMER_TOKEN_KEY = "trustdesk_customer_token";
const CUSTOMER_TICKET_ID_KEY = "trustdesk_customer_ticket_id";

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

// W17 (LLD_v4 §7): PortalVerify stores these; PortalChat/usePortalSocket
// read them. No customer *account* system exists — this is just enough
// persistence to survive a page refresh within the same verified session.
export function getCustomerToken(): string | null {
  return localStorage.getItem(CUSTOMER_TOKEN_KEY);
}
export function getCustomerTicketId(): string | null {
  return localStorage.getItem(CUSTOMER_TICKET_ID_KEY);
}
export function setCustomerSession(token: string, ticketId: string | null): void {
  localStorage.setItem(CUSTOMER_TOKEN_KEY, token);
  if (ticketId) localStorage.setItem(CUSTOMER_TICKET_ID_KEY, ticketId);
  else localStorage.removeItem(CUSTOMER_TICKET_ID_KEY);
}
export function clearCustomerSession(): void {
  localStorage.removeItem(CUSTOMER_TOKEN_KEY);
  localStorage.removeItem(CUSTOMER_TICKET_ID_KEY);
}

// V5-23 (LLD_v5 §7, HLD_v5 ADR-29): returning-customer skip-to-chat check.
// Decodes the JWT payload client-side (no signature check — the backend is
// the actual authority; this is only a UX shortcut to avoid re-rendering a
// verify form the stored token would immediately succeed past anyway) and
// compares `exp` to now. Works identically for a manual-verify (1h) or
// magic-link-derived (30d) token, since both share the same claims shape.
export function hasValidCustomerSession(): boolean {
  const token = getCustomerToken();
  if (!token) return false;
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof decoded.exp === "number" && decoded.exp * 1000 > Date.now();
  } catch {
    return false;
  }
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

// V4-4 (LLD_v4 §3): typed order shape, replacing TicketDetail's previous
// Record<string, unknown> — backs OrderCard.tsx.
export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  category: string;
  final_sale: boolean;
}

export interface Order {
  order_id: string;
  customer_id: string;
  status: string;
  placed_at: string;
  delivered_at: string | null;
  eligible_return_until: string | null;
  total: number;
  currency: string;
  payment_status: string;
  tracking_number: string | null;
  items: OrderItem[];
}

export interface TicketDetail {
  ticket: TicketSummary;
  customer: Customer;
  order: Order | null;
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

// Audit trail (AuditTrail.tsx): the lightweight row shape GET /agent-runs
// (list) returns — deliberately missing tool_calls/rejected_output/
// retrieved_doc_ids (see agentRunsRepo.ts's listAgentRuns) since those are
// only needed one-at-a-time, via the existing getAgentRun()/AgentRunTrace
// above, when a row is expanded.
export interface AgentRunSummary {
  run_id: string;
  ticket_id: string | null;
  run_type: string;
  status: "completed" | "guardrail_blocked" | "failed";
  guardrail_results: GuardrailCheckResult[];
  model_provider: string | null;
  model_name: string | null;
  latency_ms: number | null;
  created_at: string;
  ticket_subject: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  order_id: string | null;
  order_status: string | null;
  order_total: string | null;
  order_currency: string | null;
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

// W17 (LLD_v4 §7, HLD_v4 ADR-23): exactly one of order_id/ticket_id, same
// XOR the backend's CustomerVerifyRequest schema enforces.
export type CustomerVerifyInput =
  | { org_slug: string; email: string; order_id: string; ticket_id?: undefined }
  | { org_slug: string; email: string; order_id?: undefined; ticket_id: string };

export interface CustomerVerifyResult {
  customer_token: string;
  customer: { customer_id: string; name: string };
  ticket_id?: string;
}

// V5-19/23 (LLD_v5 §6/§7, HLD_v5 ADR-29): mirrors CustomerVerifyResult's
// shape exactly — a magic link ultimately mints the same CustomerTokenClaims,
// just with a longer expiry (backend-side only, opaque to this client).
export type CustomerMagicLinkResult = CustomerVerifyResult;

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
  // V4-4 (LLD_v4 §2/§3): order history behind a customer — TicketView's
  // new order-history section.
  listCustomerOrders: (customerId: string) =>
    request<{ orders: Order[] }>("GET", `/customers/${customerId}/orders`),

  requestAction: (payload: { ticket_id: string; tool_name: string; payload: Record<string, unknown> }) =>
    request<ToolActionResult>("POST", "/tool-actions", payload),
  approveAction: (actionId: string, reason: string) =>
    request<ToolActionResult>("POST", `/tool-actions/${actionId}/approve`, { reason }),
  rejectAction: (actionId: string, reason: string) =>
    request<ToolActionResult>("POST", `/tool-actions/${actionId}/reject`, { reason }),
  executeAction: (actionId: string) =>
    request<ToolActionResult>("POST", `/tool-actions/${actionId}/execute`),

  runEval: (caseIds?: string[], evalRunId?: string) =>
    request<EvalReport>("POST", "/eval-runs", {
      ...(caseIds ? { case_ids: caseIds } : {}),
      ...(evalRunId ? { eval_run_id: evalRunId } : {}),
    }),
  // V4-8 (LLD_v4 §4, HLD_v4 ADR-20): mints an eval_run_id before the run
  // starts, so EvalRunStepper can subscribe to its SSE stream first.
  startEvalRun: () => request<{ eval_run_id: string }>("POST", "/eval-runs/start"),

  getAgentRun: (runId: string) => request<AgentRunTrace>("GET", `/agent-runs/${runId}`),
  listAgentRuns: () => request<{ runs: AgentRunSummary[] }>("GET", "/agent-runs"),

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

  // W17 (LLD_v4 §7, HLD_v4 ADR-23): public, unauthenticated end-customer
  // ownership verification. Note this call never sends the agent `token` —
  // request() only attaches one if getToken() returns non-null, which is
  // fine here since PortalVerify is reached outside any agent session.
  customerVerify: (input: CustomerVerifyInput) =>
    request<CustomerVerifyResult>("POST", "/customer-auth/verify", input),

  // V5-19/23 (LLD_v5 §6/§7, HLD_v5 ADR-29): request always resolves 200 with
  // {ok: true} regardless of match — the backend's non-enumeration guarantee
  // means this call never throws for a "wrong" email, so callers should
  // treat any resolved promise as "if that email matches, a link was sent."
  customerMagicLinkRequest: (orgSlug: string, email: string, ticketId?: string) =>
    request<{ ok: true }>("POST", "/customer-auth/magic-link/request", {
      org_slug: orgSlug,
      email,
      ...(ticketId ? { ticket_id: ticketId } : {}),
    }),
  customerMagicLinkConsume: (token: string) =>
    request<CustomerMagicLinkResult>("POST", "/customer-auth/magic-link/consume", { token }),

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
