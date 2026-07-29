// V3-4 (LLD_v3 §3, HLD_v3 ADR-15): a deterministic, per-vertical greeting
// posted automatically the moment a ticket opens — no model call (keeps
// "the model proposes, deterministic code disposes" intact; a greeting
// isn't a decision, so it doesn't need one), no status transition.
import type { Vertical } from "../domain/schemas.js";

const GREETINGS: Record<Vertical, string> = {
  retail_ecommerce:
    "Thanks for reaching out! We've received your message and a support agent will review it shortly.",
  software:
    "Thanks for contacting support! Your request has been logged and a member of our team will get back to you shortly.",
  finance:
    "Thank you for your message. Your case has been recorded and a support specialist will follow up shortly.",
};

export function greetingTemplate(vertical: Vertical): string {
  return GREETINGS[vertical];
}
