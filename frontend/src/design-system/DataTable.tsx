// V2-1 design system (LLD_v2 §8): shared table primitive so Queue,
// Documents, Eval runs, and Admin don't each hand-roll <table> markup.
import type { ReactNode } from "react";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}) {
  // Mobile: a many-column table (Audit Trail, Embeddings) can't shrink to
  // fit a phone-width screen without becoming unreadable — scroll the
  // table horizontally within its own container instead of letting it
  // force the whole page wider (which would push the sidebar/content
  // layout itself off-screen).
  return (
    <div className="overflow-x-auto">
      <table className="ds-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "ds-table-row--clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
