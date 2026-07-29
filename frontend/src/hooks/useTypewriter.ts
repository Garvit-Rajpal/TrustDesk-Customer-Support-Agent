import { useEffect, useRef, useState } from "react";

// V3-8 (LLD_v3 §6, HLD_v3 ADR-18): client-side-only incremental reveal of
// already-final, post-guardrail text. This is purely cosmetic — the backend
// pipeline still runs atomically (retrieve -> draft -> L3 scan, all-or-
// nothing) exactly as before, so nothing pre-guardrail is ever shown. Resets
// and restarts whenever `text` changes (e.g. a new draft/message arrives).
export function useTypewriter(text: string, charsPerTick = 3, tickMs = 12): { display: string; done: boolean } {
  const [display, setDisplay] = useState("");
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplay("");
    indexRef.current = 0;
    if (!text) return;

    const interval = setInterval(() => {
      indexRef.current = Math.min(indexRef.current + charsPerTick, text.length);
      setDisplay(text.slice(0, indexRef.current));
      if (indexRef.current >= text.length) {
        clearInterval(interval);
      }
    }, tickMs);

    return () => clearInterval(interval);
  }, [text, charsPerTick, tickMs]);

  return { display, done: display.length >= text.length };
}
