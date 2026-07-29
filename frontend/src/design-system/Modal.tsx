import type { ReactNode } from "react";

// V3-8 (LLD_v3 §6): generic modal — first consumer is the platform-support
// consent toggle (V3-9's Admin page), kept generic since dashboard/other
// confirmations will likely reuse it too.
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-ds-lg bg-ds-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ds-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-ds-sm bg-transparent px-2 py-1 text-ds-text-muted hover:bg-ds-border/50"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
