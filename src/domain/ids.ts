import { nanoid } from "nanoid";

// ID conventions (CLAUDE.md): usr_|act_|apr_|run_|draft_|eval_run_ + nanoid.
// Seed IDs (tkt_9001, KB-REFUND-001) are preserved verbatim, never generated here.
export const newUserId = () => `usr_${nanoid()}`;
export const newActionId = () => `act_${nanoid()}`;
export const newApprovalId = () => `apr_${nanoid()}`;
export const newRunId = () => `run_${nanoid()}`;
export const newDraftId = () => `draft_${nanoid()}`;
export const newEvalRunId = () => `eval_run_${nanoid()}`;
// Not in CLAUDE.md's explicit prefix list, but POST /tickets (ADR-5) creates
// demo tickets at runtime and needs an ID shaped like the seed convention
// (tkt_9001) without colliding with seed IDs (nanoid suffix, not numeric).
export const newTicketId = () => `tkt_${nanoid()}`;
// Also not in CLAUDE.md's original prefix list — V2-3 (LLD_v2 §4) activates
// the v1-designed-but-unused feedback table.
export const newFeedbackId = () => `fbk_${nanoid()}`;
// V2-4 (LLD_v2 §1/§5): ticket_messages row IDs.
export const newMessageId = () => `msg_${nanoid()}`;
// V2-5 (LLD_v2 §1/§6): org IDs. 'org_default' (the seed tenant) is the one
// exception, created directly by the migration rather than through this.
export const newOrgId = () => `org_${nanoid()}`;
// V2-5 follow-up: POST /customers (see docs/PROGRESS.md — added so a freshly
// onboarded org, which starts with zero seed customers, can create one).
export const newCustomerId = () => `cus_${nanoid()}`;
// V4-11 (LLD_v4 §1/§5): ticket_resolution_embeddings row IDs.
export const newEmbeddingId = () => `emb_${nanoid()}`;
// V5-17 (LLD_v5 §6, HLD_v5 ADR-29): customer_magic_links row IDs.
export const newMagicLinkId = () => `mlk_${nanoid()}`;

