// V5-5 (LLD_v5 §2, HLD_v5 ADR-26): presentational site footer for the
// public marketing surface (Landing.tsx). Placeholder link targets — this
// is a capstone project, not a real company with real legal/support pages.
const COLUMNS: { heading: string; links: string[] }[] = [
  { heading: "Product", links: ["Overview", "Guardrails", "Pricing"] },
  { heading: "Company", links: ["About", "Careers", "Contact"] },
  { heading: "Legal", links: ["Privacy", "Terms"] },
];

export function Footer({ className = "" }: { className?: string }) {
  const year = new Date().getFullYear();
  return (
    <footer className={`relative border-t border-ds-border bg-ds-surface ${className}`}>
      <div className="mx-auto grid max-w-4xl gap-8 px-8 py-12 sm:grid-cols-4">
        <div className="sm:col-span-1">
          <div className="flex items-center gap-2 text-lg font-semibold text-ds-text">
            <span className="flex h-7 w-7 items-center justify-center rounded-ds-md bg-ds-accent text-xs font-bold text-ds-accent-contrast">
              TD
            </span>
            TrustDesk
          </div>
          <p className="mt-2 text-sm text-ds-text-muted">Guardrailed AI support, live in minutes.</p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <div className="text-sm font-semibold text-ds-text">{col.heading}</div>
            <ul className="mt-3 space-y-2">
              {col.links.map((link) => (
                <li key={link}>
                  <span className="cursor-default text-sm text-ds-text-muted transition-colors hover:text-ds-text">
                    {link}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-ds-border px-8 py-4 text-center text-xs text-ds-text-muted">
        © {year} TrustDesk. All rights reserved.
      </div>
    </footer>
  );
}
