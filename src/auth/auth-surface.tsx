import { Dropdown, Input, Label } from "@heroui/react";
import { type ReactNode, useEffect, useState } from "react";

import { AdminIcon } from "../components/admin/icons";
import { getLocale, locales, setLocale } from "../paraglide/runtime.js";
import { m } from "../paraglide/messages.js";
import styles from "./auth-surface.module.css";

type AuthTheme = "light" | "dark";

const ADMIN_THEME_KEY = "briefly-admin-theme";

function readStoredTheme(): AuthTheme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem(ADMIN_THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — fall through to the media query.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function AuthenticationSurface({
  title,
  description,
  children,
  footerLink,
  showHeader = true,
  showDescription = true,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
  footerLink?: Readonly<{ href: string; label: string }>;
  showHeader?: boolean;
  showDescription?: boolean;
}>) {
  const [theme, setTheme] = useState<AuthTheme>("light");
  const locale = getLocale();

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", theme);
    return () => {
      if (previous === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem(ADMIN_THEME_KEY, next);
      } catch {
        // Persisting the preference is best-effort.
      }
      return next;
    });
  }

  return (
    <main className={`briefly-theme ${styles.frame}`} data-theme={theme}>
      <div className={styles.panel}>
        <div className={styles.chrome}>
          <div className={styles.brand}>
            <span aria-hidden="true" className={styles.mark}>
              B
            </span>
            <span>Briefly</span>
          </div>
          <div className={styles.controls}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={m.toggle_theme()}
              aria-pressed={theme === "dark"}
              onClick={toggleTheme}
            >
              <AdminIcon name={theme === "light" ? "moon" : "sun"} size={16} />
            </button>
            <Dropdown.Root>
              <Dropdown.Trigger
                className={styles.iconButton}
                aria-label={m.interface_language()}
              >
                <AdminIcon name="globe" size={16} />
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label={m.interface_language()}
                  selectionMode="single"
                  selectedKeys={new Set([locale])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const next = keys.values().next().value;
                    if (
                      typeof next === "string" &&
                      (locales as readonly string[]).includes(next)
                    ) {
                      setLocale(next as (typeof locales)[number]);
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
            </Dropdown.Root>
          </div>
        </div>

        <div className={styles.body}>
          {showHeader ? (
            <header>
              <h1 className={styles.title}>{title}</h1>
              {showDescription ? (
                <p className={styles.description}>{description}</p>
              ) : null}
            </header>
          ) : null}
          {children}
        </div>
      </div>

      {footerLink ? (
        <p className={styles.footer}>
          Briefly ·{" "}
          <a className="authentication-link font-medium" href={footerLink.href}>
            {footerLink.label}
          </a>
        </p>
      ) : null}
    </main>
  );
}

export function AuthenticationField({
  id,
  label,
  type,
  autoComplete,
  minLength,
  maxLength,
  placeholder,
  helperText,
  labelEnd,
  monospace = false,
  invalid = false,
}: Readonly<{
  id: string;
  label: string;
  type: "email" | "password" | "text";
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  helperText?: string;
  labelEnd?: ReactNode;
  monospace?: boolean;
  invalid?: boolean;
}>) {
  const helperId = helperText ? `${id}-hint` : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {labelEnd}
      </div>
      <Input
        fullWidth
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-describedby={helperId}
        aria-invalid={invalid || undefined}
        className={monospace ? "font-mono" : undefined}
        required
      />
      {helperText ? (
        <p className="text-xs text-default-500" id={helperId}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}
