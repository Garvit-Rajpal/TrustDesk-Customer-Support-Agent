// V2-1 design system (LLD_v2 §8): "Layout shell: sidebar (Queue, Dashboard,
// Documents, Evals, Admin — items filtered by role), topbar (org name,
// user, logout)." Role-based filtering lands with W2 (RBAC); every item is
// shown to every signed-in user until then.
import type { ReactNode } from "react";

export interface NavItem {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function Shell({
  navItems,
  displayName,
  orgName,
  onLogout,
  children,
}: {
  navItems: NavItem[];
  displayName: string;
  orgName: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  // Sidebar + topbar stay fixed on screen; only the main content column
  // scrolls (previously the whole page scrolled as one, so the sidebar nav
  // scrolled out of view along with long ticket/dashboard content).
  //
  // W18 (HLD_v4 ADR-24): typography/nav pass — the sidebar now carries the
  // same "TD" badge Login/Signup/the favicon use (previously plain text,
  // the one place in the authenticated app that didn't); active nav items
  // get a left accent rail instead of relying on background color alone,
  // and every interactive element transitions instead of snapping.
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-full w-[210px] shrink-0 flex-col overflow-y-auto bg-sidebar-bg px-3 py-4 text-sidebar-text">
        <div className="flex items-center gap-2 px-2 pb-6">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-ds-sm bg-ds-accent text-xs font-bold text-ds-accent-contrast">
            TD
          </div>
          <span className="text-[1.05rem] font-bold tracking-tight">TrustDesk</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`relative rounded-ds-sm border-0 px-2.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-sidebar-active-bg hover:text-sidebar-text ${
                item.active
                  ? "bg-sidebar-active-bg font-semibold text-sidebar-text before:absolute before:-left-3 before:top-1/2 before:h-4 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-ds-accent before:content-['']"
                  : "bg-transparent text-sidebar-text-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-4 border-b border-ds-border bg-ds-surface px-6 py-3">
          <span className="text-sm font-medium text-ds-text">{orgName}</span>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ds-accent/10 text-xs font-semibold text-ds-accent">
                {initial}
              </div>
              <span className="text-sm text-ds-text-muted">{displayName}</span>
            </div>
            <button className="link-button transition-opacity hover:opacity-70" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
        <main className="max-w-[1100px] flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
