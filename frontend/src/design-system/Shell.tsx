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
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex h-full w-[200px] shrink-0 flex-col overflow-y-auto bg-sidebar-bg px-3 py-4 text-sidebar-text">
        <div className="px-2 pb-5 text-[1.05rem] font-bold">TrustDesk</div>
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={item.onClick}
              className={`rounded-ds-sm border-0 px-2.5 py-2 text-left text-sm hover:bg-sidebar-active-bg hover:text-sidebar-text ${
                item.active
                  ? "bg-sidebar-active-bg font-semibold text-sidebar-text"
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
          <span className="text-sm text-ds-text-muted">{orgName}</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-ds-text-muted">{displayName}</span>
            <button className="link-button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
        <main className="max-w-[1100px] flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
