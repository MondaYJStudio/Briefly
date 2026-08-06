import { Alert, Dropdown, Separator } from "@heroui/react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { getLocale, setLocale } from "../../paraglide/runtime.js";
import { m } from "../../paraglide/messages.js";
import { AdminIcon } from "./icons";
import styles from "./admin-shell.module.css";

export type AdminDrawerKind = "settings" | "account";
export type AdminTheme = "light" | "dark";

export interface AdministratorIdentity {
  email: string;
  initials: string;
}

interface AdminShellProps {
  identity: AdministratorIdentity;
  theme: AdminTheme;
  mobileNavigationOpen: boolean;
  signOutPending: boolean;
  signOutError: boolean;
  onToggleTheme: () => void;
  onOpenDrawer: (drawer: AdminDrawerKind) => void;
  onSignOut: () => void;
  onMobileNavigationChange: (open: boolean) => void;
  children: ReactNode;
}

const NAV_ITEMS: ReadonlyArray<{
  to: "/admin/articles" | "/admin/media" | "/admin/trash";
  icon: "articles" | "media" | "trash";
  label: () => string;
}> = [
  { to: "/admin/articles", icon: "articles", label: () => m.articles() },
  { to: "/admin/media", icon: "media", label: () => m.media() },
  { to: "/admin/trash", icon: "trash", label: () => m.trash() },
];

/**
 * Admin shell: persistent left rail (Articles / Media / Trash) with the
 * identity menu in the footer — Settings, Account, theme, locale and sign-out
 * live there, matching the approved administration shell.
 */
export function AdminShell({
  identity,
  theme,
  mobileNavigationOpen,
  signOutPending,
  signOutError,
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
  const locale = getLocale();
  const { email, initials } = identity;

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onMobileNavigationChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavigationOpen, onMobileNavigationChange]);

  return (
    <div
      className={`briefly-theme ${styles.shell}${editingArticle ? ` ${styles.editorShell}` : ""}`}
      data-theme={theme}
    >
      <a
        className="skip-link"
        href={editingArticle ? "#canvas" : "#admin-main"}
      >
        {m.skip_to_content()}
      </a>

      <aside
        className={`${styles.sidebar}${mobileNavigationOpen ? ` ${styles.sidebarOpen}` : ""}`}
        aria-label={m.admin_navigation()}
      >
        <Link
          to="/admin/articles"
          className={styles.sidebarBrand}
          onClick={() => onMobileNavigationChange(false)}
        >
          <span className={styles.logoMark} aria-hidden="true">
            B
          </span>
          Briefly
        </Link>

        <nav className={styles.nav} aria-label={m.content_sections()}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={styles.navItem}
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
              {item.label()}
            </Link>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          {signOutError ? (
            <Alert
              status="danger"
              role="alert"
              className={styles.signOutError}
            >
              <Alert.Content>
                <Alert.Title>{m.sign_out_failed()}</Alert.Title>
                <Alert.Description>
                  {m.sign_out_failed_description()}
                </Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}
          <Dropdown.Root>
            <Dropdown.Trigger
              className={styles.adminId}
              aria-label={m.settings_and_account_menu({ email })}
            >
              <span className={styles.avatar} aria-hidden="true">
                {initials}
              </span>
              <span className={styles.meta}>
                <span className={styles.metaLabel}>{m.signed_in_as()}</span>
                <span className={styles.email}>{email}</span>
              </span>
              <AdminIcon name="chevron" size={14} className={styles.chevron} />
            </Dropdown.Trigger>
            <Dropdown.Popover placement="top start">
              <Dropdown.Menu
                aria-label={m.settings_and_account()}
                disabledKeys={signOutPending ? ["sign-out"] : []}
                onAction={(key) => {
                  if (key === "settings") onOpenDrawer("settings");
                  else if (key === "account") onOpenDrawer("account");
                  else if (key === "theme") onToggleTheme();
                  else if (key === "locale") {
                    setLocale(locale === "en" ? "zh-CN" : "en");
                  } else if (key === "sign-out") onSignOut();
                }}
              >
                <Dropdown.Item id="settings" textValue={m.settings_menu()}>
                  <span className={styles.menuRow}>
                    <AdminIcon name="settings" size={16} />
                    {m.settings_menu()}
                  </span>
                </Dropdown.Item>
                <Dropdown.Item id="account" textValue={m.account_menu()}>
                  <span className={styles.menuRow}>
                    <AdminIcon name="account" size={16} />
                    {m.account_menu()}
                  </span>
                </Dropdown.Item>
                <Separator />
                <Dropdown.Item id="theme" textValue={m.toggle_theme()}>
                  <span className={styles.menuRow}>
                    <AdminIcon
                      name={theme === "light" ? "moon" : "sun"}
                      size={16}
                    />
                    {theme === "light" ? m.dark_mode() : m.light_mode()}
                  </span>
                </Dropdown.Item>
                <Dropdown.Item id="locale" textValue={m.interface_language()}>
                  <span className={styles.menuRow}>
                    <AdminIcon name="globe" size={16} />
                    {locale === "en"
                      ? m.switch_to_zh_cn()
                      : m.switch_to_english()}
                  </span>
                </Dropdown.Item>
                <Separator />
                <Dropdown.Item
                  id="sign-out"
                  textValue={m.sign_out()}
                  className="text-danger"
                >
                  {m.sign_out()}
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.Root>
        </div>
      </aside>

      <button
        className={`${styles.scrim}${mobileNavigationOpen ? ` ${styles.scrimOpen}` : ""}`}
        type="button"
        aria-label={m.close_navigation()}
        tabIndex={mobileNavigationOpen ? 0 : -1}
        onClick={() => onMobileNavigationChange(false)}
      />

      <div className={styles.main}>
        <div className={styles.mobileBar}>
          <button
            className={`${styles.navItem} ${styles.mobileNavButton}`}
            type="button"
            aria-label={m.open_navigation()}
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
