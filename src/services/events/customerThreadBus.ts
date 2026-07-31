// W17 (LLD_v4 §7, V4-23): a ticket-scoped pub/sub, deliberately separate
// from pipelineEventBus (which is keyed by run_id, for the SSE pipeline
// stepper's stage-by-stage progress). customerChatServer.ts needs something
// keyed by ticket_id instead, since a portal connection must also receive a
// *later*, out-of-band human reply (sendManualReply(), no run_id at all,
// possibly sent hours after the customer disconnected and reconnected).
// sendDraft()/sendManualReply() in ticketThread.ts publish here on every
// successful "ok" outcome — the only two call sites that ever produce a
// sent-status outbound message.
import { EventEmitter } from "node:events";
import type { TicketMessageRow } from "../../db/repos/ticketMessagesRepo.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

function channel(ticketId: string): string {
  return `ticket:${ticketId}`;
}

export function publishSentMessage(ticketId: string, message: TicketMessageRow): void {
  emitter.emit(channel(ticketId), message);
}

export function subscribeSentMessages(
  ticketId: string,
  listener: (message: TicketMessageRow) => void
): () => void {
  emitter.on(channel(ticketId), listener);
  return () => emitter.off(channel(ticketId), listener);
}
