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
  to:
    | "/admin/articles"
    | "/admin/media"
    | "/admin/public-templates"
    | "/admin/trash";
  icon: "articles" | "media" | "globe" | "trash";
  label: () => string;
}> = [
  { to: "/admin/articles", icon: "articles", label: () => m.articles() },
  { to: "/admin/media", icon: "media", label: () => m.media() },
  {
    to: "/admin/public-templates",
    icon: "globe",
    label: () => m.public_templates(),
  },
  { to: "/admin/trash", icon: "trash", label: () => m.trash() },
];

/**
 * Admin shell: persistent left rail (Articles / Media / Public Templates /
 * Trash) with the identity menu in the footer — Settings, Account, theme,
 * locale and sign-out live there, matching the approved administration shell.
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
      className={`briefly-theme text-sm ${styles.shell} grid${editingArticle ? ` ${styles.editorShell} grid h-dvh` : ""}`}
      data-theme={theme}
    >
      <a
        className="skip-link py-2 px-4"
        href={editingArticle ? "#canvas" : "#admin-main"}
      >
        {m.skip_to_content()}
      </a>

      <aside
        className={`${styles.sidebar} sticky top-0 flex h-dvh flex-col max-[860px]:top-0${mobileNavigationOpen ? ` ${styles.sidebarOpen}` : ""}`}
        aria-label={m.admin_navigation()}
      >
        <Link
          to="/admin/articles"
          className={`${styles.sidebarBrand} flex w-full cursor-pointer items-center border-0 text-left text-base gap-2 py-4 px-5`}
          onClick={() => onMobileNavigationChange(false)}
        >
          <span
            className={`${styles.logoMark} grid shrink-0 place-items-center`}
            aria-hidden="true"
          >
            B
          </span>
          Briefly
        </Link>

        <nav
          className={`${styles.nav} flex flex-1 flex-col overflow-y-auto p-3`}
          aria-label={m.content_sections()}
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`${styles.navItem} flex w-full cursor-pointer items-center border-0 text-left no-underline gap-3 py-2 px-3`}
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

        <div className={`${styles.sidebarFooter} flex flex-col p-3 gap-1`}>
          {signOutError ? (
            <Alert status="danger" role="alert" className="mt-0 mx-1 mb-2">
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
              className={`${styles.adminId} flex w-full min-w-0 cursor-pointer items-center border-0 text-left gap-3 py-2 px-3`}
              aria-label={m.settings_and_account_menu({ email })}
            >
              <span
                className={`${styles.avatar} grid shrink-0 place-items-center text-xs`}
                aria-hidden="true"
              >
                {initials}
              </span>
              <span className={`${styles.meta} min-w-0`}>
                <span className={`${styles.metaLabel} block text-xs`}>
                  {m.signed_in_as()}
                </span>
                <span className={`${styles.email} block text-xs`}>{email}</span>
              </span>
              <AdminIcon name="chevron" size={14} className={styles.chevron} />
            </Dropdown.Trigger>
            <Dropdown.Popover
              placement="top start"
              className={styles.identityMenu}
            >
              <Dropdown.Menu
                aria-label={m.settings_and_account()}
                disabledKeys={signOutPending ? ["sign-out"] : []}
                onAction={(key) => {
                  if (key === "settings") onOpenDrawer("settings");
                  else if (key === "account") onOpenDrawer("account");
                  else if (key === "theme") onToggleTheme();
                  else if (key === "sign-out") onSignOut();
                }}
              >
                <Dropdown.Item id="settings" textValue={m.settings_menu()}>
                  <span
                    className={`${styles.menuRow} flex w-full min-w-0 items-center`}
                  >
                    <AdminIcon name="settings" size={16} />
                    <span className={`${styles.menuLabel} min-w-0`}>
                      {m.settings_menu()}
                    </span>
                    <AdminIcon
                      name="chevron-right"
                      size={14}
                      className={`${styles.menuAffordance} shrink-0`}
                    />
                  </span>
                </Dropdown.Item>
                <Dropdown.Item id="account" textValue={m.account_menu()}>
                  <span
                    className={`${styles.menuRow} flex w-full min-w-0 items-center`}
                  >
                    <AdminIcon name="account" size={16} />
                    <span className={`${styles.menuLabel} min-w-0`}>
                      {m.account_menu()}
                    </span>
                    <AdminIcon
                      name="chevron-right"
                      size={14}
                      className={`${styles.menuAffordance} shrink-0`}
                    />
                  </span>
                </Dropdown.Item>
                <Separator />
                <Dropdown.Item
                  id="theme"
                  textValue={`${m.appearance()}, ${theme === "light" ? m.light_mode() : m.dark_mode()}`}
                >
                  <span
                    className={`${styles.menuRow} flex w-full min-w-0 items-center`}
                  >
                    <AdminIcon
                      name={theme === "light" ? "sun" : "moon"}
                      size={16}
                    />
                    <span className={`${styles.menuLabel} min-w-0`}>
                      {m.appearance()}
                    </span>
                    <span className={`${styles.menuValue} text-xs shrink-0`}>
                      {theme === "light" ? m.light_mode() : m.dark_mode()}
                    </span>
                  </span>
                </Dropdown.Item>
                <Dropdown.SubmenuTrigger>
                  <Dropdown.Item id="locale" textValue={m.interface_language()}>
                    <span
                      className={`${styles.menuRow} flex w-full min-w-0 items-center`}
                    >
                      <AdminIcon name="globe" size={16} />
                      <span className={`${styles.menuLabel} min-w-0`}>
                        {m.interface_language()}
                      </span>
                    </span>
                    <Dropdown.SubmenuIndicator />
                  </Dropdown.Item>
                  <Dropdown.Popover placement="end top">
                    <Dropdown.Menu
                      aria-label={m.interface_language()}
                      selectionMode="single"
                      selectedKeys={new Set([locale])}
                      onSelectionChange={(keys) => {
                        if (keys === "all") return;
                        const next = keys.values().next().value;
                        if (next === "en" || next === "zh-CN") {
                          setLocale(next);
                        }
                      }}
                    >
                      <Dropdown.Item id="en" textValue={m.switch_to_english()}>
                        <Dropdown.ItemIndicator />
                        {m.switch_to_english()}
                      </Dropdown.Item>
                      <Dropdown.Item id="zh-CN" textValue={m.switch_to_zh_cn()}>
                        <Dropdown.ItemIndicator />
                        {m.switch_to_zh_cn()}
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown.SubmenuTrigger>
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
        className={`${styles.scrim} border-0 p-0${mobileNavigationOpen ? ` ${styles.scrimOpen}` : ""}`}
        type="button"
        aria-label={m.close_navigation()}
        tabIndex={mobileNavigationOpen ? 0 : -1}
        onClick={() => onMobileNavigationChange(false)}
      />

      <div className={`${styles.main} flex min-w-0 flex-col`}>
        <div
          className={`${styles.mobileBar} hidden sticky top-0 items-center max-[860px]:flex gap-3 py-2 px-3`}
        >
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
