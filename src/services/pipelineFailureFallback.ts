// Shared by triage.ts (a triage call that never produces valid output) and
// ticketIntake.ts's runIntakePipeline() (an unexpected exception anywhere
// after a *successful* triage — draft generation/auto-send throwing, not
// the graceful guardrail_blocked fallback generateDraft() already returns
// on its own parse failure). Both call sites hit the same underlying
// customer-facing gap: the pipeline produced nothing to send back, and
// without this, the customer sees total silence.
//
// Posts a real, persisted ticket_messages row (not an ephemeral WS-only
// status frame like customerChatServer.ts's AWAITING_SPECIALIST_TEXT) so a
// customer who reloads the portal still sees it, and publishes it via
// customerThreadBus so any live-connected customer-chat WS client gets it
// pushed immediately — the same channel sendDraft()/sendManualReply() use.
// Best-effort: a failure here must never mask the pipeline failure that
// triggered it, so every caller treats this as non-throwing.
import type { OrgContext } from "../domain/orgContext.js";
import { newMessageId } from "../domain/ids.js";
import { insertMessage } from "../db/repos/ticketMessagesRepo.js";
import { publishSentMessage } from "./events/customerThreadBus.js";
import { PIPELINE_FAILURE_TEXT } from "./pipelineFailureTemplate.js";

export async function postPipelineFailureFallback(ctx: OrgContext, ticketId: string): Promise<void> {
  try {
    const message = await insertMessage(ctx, {
      message_id: newMessageId(),
      ticket_id: ticketId,
      direction: "outbound",
      body: PIPELINE_FAILURE_TEXT,
      author: "system",
    });
    publishSentMessage(ticketId, message);
  } catch (err) {
    console.error("[trustdesk] failed to post pipeline-failure fallback message:", err);
  }
}
