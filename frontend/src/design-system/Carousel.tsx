import { useEffect, useRef, useState, type ReactNode } from "react";

// V5-4 (LLD_v5 §2, HLD_v5 ADR-25): generic, children-based auto-advancing
// carousel. CSS-only translateX track driven by plain setInterval — the
// same primitive-JS shape useTypewriter.ts already uses, no new dependency.
// First consumer is W23's testimonials section.
export function Carousel({
  children,
  autoAdvanceMs = 5000,
  pauseOnHover = true,
}: {
  children: ReactNode[];
  autoAdvanceMs?: number;
  pauseOnHover?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const count = children.length;

  useEffect(() => {
    if (count <= 1 || (pauseOnHover && hovered)) return;
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, autoAdvanceMs);
    return () => clearInterval(interval);
  }, [count, autoAdvanceMs, pauseOnHover, hovered]);

  function goTo(i: number) {
    setIndex(((i % count) + count) % count);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(index + 1);
    }
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="overflow-hidden">
        <div
          ref={trackRef}
          className="flex transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
          role="group"
          aria-roledescription="carousel"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {children.map((child, i) => (
            <div key={i} className="w-full shrink-0">
              {child}
            </div>
          ))}
        </div>
      </div>

      {count > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          {children.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              onClick={() => goTo(i)}
              className={`h-2 w-2 rounded-full transition-colors ${
                i === index ? "bg-ds-accent" : "bg-ds-border hover:bg-ds-text-muted"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
