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
  return (
    <div className="ds-shell">
      <aside className="ds-sidebar">
        <div className="ds-sidebar-brand">TrustDesk</div>
        <nav className="ds-sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`ds-sidebar-link${item.active ? " ds-sidebar-link--active" : ""}`}
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="ds-shell-main">
        <header className="ds-topbar">
          <span className="ds-topbar-org">{orgName}</span>
          <div className="ds-topbar-right">
            <span className="ds-topbar-user">{displayName}</span>
            <button className="link-button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
        <main className="ds-shell-content">{children}</main>
      </div>
    </div>
  );
}
