// V3-8 (LLD_v3 §6): dashboard summary tile — Tailwind-first, per the plan's
// Tailwind adoption decision (new components are Tailwind-first from the
// start; existing hand-rolled CSS components migrate in V3-9).
export function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
      <div className="text-sm font-medium text-ds-text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ds-text">{value}</div>
      {hint && <div className="mt-1 text-xs text-ds-text-muted">{hint}</div>}
    </div>
  );
}
