// V2-1 design system (LLD_v2 §8): "Layout shell: sidebar (Queue, Dashboard,
// Documents, Evals, Admin — items filtered by role), topbar (org name,
// user, logout)." Role-based filtering lands with W2 (RBAC); every item is
// shown to every signed-in user until then.
import { useState, type ReactNode } from "react";

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
  //
  // Mobile follow-up: below md, the always-visible 210px sidebar left less
  // than half the viewport for content on a phone-width screen — it's now
  // an off-canvas drawer (hidden by default, toggled by a hamburger button
  // in the topbar, closes on backdrop click or on picking a nav item)
  // instead of permanently occupying screen space. md+ is unchanged —
  // always-visible static sidebar, no drawer/backdrop behavior at all.
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  function handleNavClick(item: NavItem) {
    item.onClick();
    setMobileNavOpen(false);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full w-[210px] shrink-0 -translate-x-full flex-col overflow-y-auto bg-sidebar-bg px-3 py-4 text-sidebar-text transition-transform duration-200 md:static md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : ""
        }`}
      >
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
              onClick={() => handleNavClick(item)}
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
        <header className="flex shrink-0 items-center gap-2 border-b border-ds-border bg-ds-surface px-3 py-3 sm:gap-4 sm:px-6">
          <button
            type="button"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMobileNavOpen((v) => !v)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ds-sm border-0 bg-transparent text-ds-text md:hidden"
          >
            <span className="sr-only">Toggle navigation</span>
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 5A.75.75 0 0 1 2.75 9h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 9.75Zm0 5a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <span className="truncate text-sm font-medium text-ds-text">{orgName}</span>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ds-accent/10 text-xs font-semibold text-ds-accent">
                {initial}
              </div>
              <span className="hidden text-sm text-ds-text-muted sm:inline">{displayName}</span>
            </div>
            <button className="link-button shrink-0 transition-opacity hover:opacity-70" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
        <main className="max-w-[1100px] flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
