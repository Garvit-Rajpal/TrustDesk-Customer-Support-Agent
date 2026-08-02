// V5-9 (LLD_v5 §4, HLD_v5 ADR-26): social-proof card for Landing.tsx's
// testimonials carousel. Fictional placeholder copy (capstone context, no
// user-generated content, no new DB table) — see ADR-26.
export function TestimonialCard({
  quote,
  name,
  role,
}: {
  quote: string;
  name: string;
  role: string;
}) {
  const initial = name.charAt(0);
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col items-center rounded-ds-lg border border-ds-border bg-ds-surface p-8 text-center shadow-sm">
      <p className="text-lg text-ds-text">&ldquo;{quote}&rdquo;</p>
      <div className="mt-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ds-accent text-sm font-semibold text-ds-accent-contrast">
          {initial}
        </span>
        <div className="text-left">
          <div className="text-sm font-semibold text-ds-text">{name}</div>
          <div className="text-xs text-ds-text-muted">{role}</div>
        </div>
      </div>
    </div>
  );
}
