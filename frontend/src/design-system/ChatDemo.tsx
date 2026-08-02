import { useEffect, useRef, useState } from "react";
import { useTypewriter } from "../hooks/useTypewriter.js";

// V5-6/V5-7 (LLD_v5 §3, HLD_v5 ADR-26): a hardcoded, looping, obviously-fake
// conversation for the Landing.tsx hero. Zero backend calls, zero real AI —
// the "Example conversation" label plus the absence of any compose box are
// deliberate: this must never read as a live chat a visitor could type into.
// The message frame is a fixed height with internal scroll (not a growing
// div) so the rest of the page doesn't reflow as lines are typed out.
type ScriptLine = { author: "customer" | "agent"; text: string; delayMs: number };

const SCRIPT: ScriptLine[] = [
  { author: "customer", text: "Hi — my order #48213 still hasn't arrived and it's been 9 days.", delayMs: 900 },
  {
    author: "agent",
    text: "Sorry about that! Order #48213 shipped on day 1 but you're past our 7-day delivery window, so you're eligible for a replacement or a refund — which would you prefer?",
    delayMs: 1200,
  },
  { author: "customer", text: "A refund is fine, thanks.", delayMs: 900 },
  {
    author: "agent",
    text: "Done — refund issued to your original payment method, 3–5 business days to land. Anything else I can help with?",
    delayMs: 3200,
  },
];

const START_DELAY_MS = 500;

export function ChatDemo() {
  const [revealed, setRevealed] = useState(0);
  const current = revealed > 0 ? SCRIPT[revealed - 1] : undefined;
  const isCurrentAgent = current?.author === "agent";
  const { display, done } = useTypewriter(isCurrentAgent ? current!.text : "");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (revealed !== 0) return;
    const t = setTimeout(() => setRevealed(1), START_DELAY_MS);
    return () => clearTimeout(t);
  }, [revealed]);

  useEffect(() => {
    if (!current) return;
    if (isCurrentAgent && !done) return;
    const t = setTimeout(() => {
      setRevealed((r) => (r < SCRIPT.length ? r + 1 : 0));
    }, current.delayMs);
    return () => clearTimeout(t);
  }, [current, isCurrentAgent, done]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [revealed, display]);

  return (
    <div className="w-full text-left">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-ds-text-muted">Example conversation</div>
      <div
        ref={scrollRef}
        className="h-80 space-y-3 overflow-y-auto rounded-ds-lg border border-ds-border bg-ds-surface/60 p-4 backdrop-blur"
      >
        {SCRIPT.slice(0, revealed).map((line, i) => {
          const isAgent = line.author === "agent";
          const isTyping = isAgent && i === revealed - 1;
          const text = isTyping ? display || line.text.slice(0, 1) : line.text;
          return (
            <div key={i} className={`flex animate-fade-in-up ${isAgent ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] animate-scale-in rounded-ds-lg px-3 py-2 text-sm shadow-sm ${
                  isAgent
                    ? "bg-ds-accent text-ds-accent-contrast"
                    : "border border-ds-border bg-ds-surface text-ds-text"
                }`}
              >
                {text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
