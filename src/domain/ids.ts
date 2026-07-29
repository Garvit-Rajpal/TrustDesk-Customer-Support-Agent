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

