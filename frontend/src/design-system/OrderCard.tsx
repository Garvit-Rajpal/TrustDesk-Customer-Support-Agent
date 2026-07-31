// V4-4 (LLD_v4 §3, HLD_v4 ADR-19): replaces TicketView's raw
// <pre>{JSON.stringify(order)}</pre> with a real card, item table via the
// shared DataTable primitive. `compact` renders a condensed row for the
// order-history list (every other order behind this customer).
import type { Order, OrderItem } from "../api.js";
import { StatusBadge } from "./StatusBadge.js";
import { DataTable, type DataTableColumn } from "./DataTable.js";

const ITEM_COLUMNS: DataTableColumn<OrderItem>[] = [
  { key: "sku", header: "SKU", render: (item) => item.sku },
  { key: "name", header: "Name", render: (item) => item.name },
  { key: "quantity", header: "Qty", render: (item) => String(item.quantity) },
  { key: "category", header: "Category", render: (item) => item.category },
  { key: "final_sale", header: "Final sale", render: (item) => (item.final_sale ? "Yes" : "No") },
];

function formatTotal(order: Order): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: order.currency }).format(order.total);
}

export function OrderCard({ order, compact }: { order: Order; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-ds-sm border border-ds-border bg-ds-surface px-3 py-2 text-sm">
        <div>
          <span className="font-medium text-ds-text">{order.order_id}</span>
          <span className="ml-2 text-ds-text-muted">{order.placed_at}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-ds-text-muted">{formatTotal(order)}</span>
          <StatusBadge value={order.status} label={order.status} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-ds-lg border border-ds-border bg-ds-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ds-text">{order.order_id}</h4>
        <StatusBadge value={order.status} label={order.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1 text-xs">
        <dt className="text-ds-text-muted">Placed</dt>
        <dd className="text-ds-text">{order.placed_at}</dd>
        <dt className="text-ds-text-muted">Delivered</dt>
        <dd className="text-ds-text">{order.delivered_at ?? "—"}</dd>
        <dt className="text-ds-text-muted">Total</dt>
        <dd className="text-ds-text">{formatTotal(order)}</dd>
        <dt className="text-ds-text-muted">Payment</dt>
        <dd className="text-ds-text">{order.payment_status}</dd>
        <dt className="text-ds-text-muted">Tracking</dt>
        <dd className="text-ds-text">{order.tracking_number ?? "—"}</dd>
      </dl>
      {order.items.length > 0 && (
        <div className="mt-3">
          <DataTable columns={ITEM_COLUMNS} rows={order.items} rowKey={(item) => item.sku} />
        </div>
      )}
    </div>
  );
}
