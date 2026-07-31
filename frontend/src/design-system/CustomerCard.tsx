// V4-4 (LLD_v4 §3, HLD_v4 ADR-19): replaces TicketView's raw
// <pre>{JSON.stringify(customer)}</pre> with a real card. Tailwind-first,
// same card/label conventions as MetricTile.tsx.
import type { Customer } from "../api.js";
import { StatusBadge } from "./StatusBadge.js";

export function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ds-text">{customer.name}</h4>
        <StatusBadge value={customer.tier} />
      </div>
      <p className="mt-1 text-sm text-ds-text-muted">{customer.email}</p>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-ds-text-muted">Country</dt>
        <dd className="text-ds-text">{customer.country}</dd>
        <dt className="text-ds-text-muted">Verified</dt>
        <dd className="text-ds-text">{customer.verified ? "Yes" : "No"}</dd>
      </dl>
      {customer.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {customer.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-ds-sm bg-ds-bg px-2 py-0.5 text-xs text-ds-text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
