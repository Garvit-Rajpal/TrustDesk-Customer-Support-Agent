// V3-8 (LLD_v3 §6): dashboard summary tile — Tailwind-first, per the plan's
// Tailwind adoption decision (new components are Tailwind-first from the
// start; existing hand-rolled CSS components migrate in V3-9).
// V5-13 (LLD_v5 §5, HLD_v5 ADR-27): optional `style` passthrough so callers
// can stagger a row of tiles' scale-in mount by index, same pattern
// ChatDemo.tsx's bubble stagger uses.
export function MetricTile({
  label,
  value,
  hint,
  style,
}: {
  label: string;
  value: string;
  hint?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className="animate-scale-in rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="text-sm font-medium text-ds-text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ds-text">{value}</div>
      {hint && <div className="mt-1 text-xs text-ds-text-muted">{hint}</div>}
    </div>
  );
}
