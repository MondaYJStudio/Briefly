import { Dropdown, Separator } from "@heroui/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { AdminIcon } from "./icons";

export type AdminDrawerKind = "settings" | "account";
export type AdminTheme = "light" | "dark";

interface AdminShellProps {
  theme: AdminTheme;
  mobileNavigationOpen: boolean;
  signOutPending: boolean;
  onToggleTheme: () => void;
  onOpenDrawer: (drawer: AdminDrawerKind) => void;
  onSignOut: () => void;
  onMobileNavigationChange: (open: boolean) => void;
  children: ReactNode;
}

const NAV_ITEMS: ReadonlyArray<{
  to: string;
  icon: "articles" | "media" | "trash";
  label: string;
}> = [
  { to: "/admin/articles", icon: "articles", label: "Articles" },
  { to: "/admin/media", icon: "media", label: "Media" },
  { to: "/admin/trash", icon: "trash", label: "Trash" },
];

/**
 * Admin shell: persistent left rail (Articles / Media / Trash) with the
 * identity menu in the footer — Settings, Account, theme and sign-out live
 * there, exactly as the prototype specifies.
 */
export function AdminShell({
  theme,
  mobileNavigationOpen,
  signOutPending,
  onToggleTheme,
  onOpenDrawer,
  onSignOut,
  onMobileNavigationChange,
  children,
}: AdminShellProps) {
  const matchRoute = useMatchRoute();
  const editingArticle = Boolean(
    matchRoute({ to: "/admin/articles/$articleId", fuzzy: true }),
  );

  return (
    <div
      className={`briefly-theme shell${editingArticle ? " editor-shell" : ""}`}
      data-theme={theme}
    >
      <a
        className="skip-link"
        href={editingArticle ? "#canvas" : "#admin-main"}
      >
        Skip to content
      </a>

      <aside
        className={`sidebar${mobileNavigationOpen ? " is-open" : ""}`}
        aria-label="Admin navigation"
      >
        <Link
          to="/admin/articles"
          className="sidebar-brand"
          onClick={() => onMobileNavigationChange(false)}
        >
          <span className="logo-mark" aria-hidden="true">
            B
          </span>
          Briefly
        </Link>

        <nav aria-label="Content sections">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="nav-item"
              aria-current={
                matchRoute({
                  to: item.to,
                  fuzzy: item.to === "/admin/articles",
                })
                  ? "page"
                  : undefined
              }
              onClick={() => onMobileNavigationChange(false)}
            >
              <AdminIcon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <h2 className="session-label">Administrator session</h2>
          <Dropdown.Root>
            <Dropdown.Trigger
              className="admin-id"
              aria-label="Settings and account menu — Administrator"
            >
              <span className="avatar" aria-hidden="true">
                AD
              </span>
              <span className="meta">
                <span className="label" style={{ display: "block" }}>
                  Signed in as
                </span>
                <span className="email" style={{ display: "block" }}>
                  Administrator
                </span>
              </span>
              <AdminIcon
                name="chevron"
                size={14}
                style={{ marginLeft: "auto", color: "var(--foreground-faint)" }}
              />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="top start">
              <Dropdown.Menu
                aria-label="Settings and account"
                disabledKeys={signOutPending ? ["sign-out"] : []}
                onAction={(key) => {
                  if (key === "settings") onOpenDrawer("settings");
                  else if (key === "account") onOpenDrawer("account");
                  else if (key === "theme") onToggleTheme();
                  else if (key === "sign-out") onSignOut();
                }}
              >
                <Dropdown.Item id="settings" textValue="Settings">
                  <span className="row" style={{ gap: "0.75rem" }}>
                    <AdminIcon name="settings" size={16} />
                    Settings…
                  </span>
                </Dropdown.Item>
                <Dropdown.Item id="account" textValue="Account">
                  <span className="row" style={{ gap: "0.75rem" }}>
                    <AdminIcon name="account" size={16} />
                    Account…
                  </span>
                </Dropdown.Item>
                <Separator />
                <Dropdown.Item id="theme" textValue="Toggle theme">
                  <span className="row" style={{ gap: "0.75rem" }}>
                    <AdminIcon
                      name={theme === "light" ? "moon" : "sun"}
                      size={16}
                    />
                    {theme === "light" ? "Dark mode" : "Light mode"}
                  </span>
                </Dropdown.Item>
                <Separator />
                <Dropdown.Item
                  id="sign-out"
                  textValue="Sign out"
                  className="text-danger"
                >
                  Sign out
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.Root>
        </div>
      </aside>

      <button
        className={`scrim${mobileNavigationOpen ? " is-open" : ""}`}
        type="button"
        aria-label="Close navigation"
        tabIndex={mobileNavigationOpen ? 0 : -1}
        onClick={() => onMobileNavigationChange(false)}
      />

      <div className="main">
        <div className="mobile-bar">
          <button
            className="nav-item"
            style={{ width: "auto", padding: "0.5rem" }}
            type="button"
            aria-label="Open navigation"
            onClick={() => onMobileNavigationChange(true)}
          >
            <AdminIcon name="menu" size={20} />
          </button>
          <strong>Briefly</strong>
        </div>
        {children}
      </div>
    </div>
  );
}
