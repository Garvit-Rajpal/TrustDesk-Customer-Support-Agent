import type { ReactNode } from "react";

const MAX_WIDTH: Record<"md" | "lg", string> = {
  md: "max-w-md",
  lg: "max-w-2xl",
};

// V3-8 (LLD_v3 §6): generic modal. `size` defaults to "md" (unchanged from
// before this prop existed) — "lg" is for content that needs more room,
// e.g. AuditTrail.tsx's TracePanel, which renders guardrail-check lists and
// full JSON blobs that "md" (28rem) crowds badly.
export function Modal({
  title,
  onClose,
  children,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${MAX_WIDTH[size]} max-h-[85vh] overflow-y-auto rounded-ds-lg bg-ds-surface p-6 shadow-lg`}
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
