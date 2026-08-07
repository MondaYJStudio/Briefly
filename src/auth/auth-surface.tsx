import { Dropdown, Input, Label } from "@heroui/react";
import { type ReactNode, useEffect, useState } from "react";

import { AdminIcon } from "../components/admin/icons";
import { getLocale, locales, setLocale } from "../paraglide/runtime.js";
import { m } from "../paraglide/messages.js";
import { APP_LOCALE_OPTIONS, canonicalizeAppLocale } from "../locales/registry";
import { useHydrated } from "../locales/use-hydrated";
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
  const hydrated = useHydrated();
  const locale = getLocale();
  const selectedLocale = canonicalizeAppLocale(locale) ?? locale;

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
    <main
      className={`briefly-theme ${styles.frame} flex flex-col items-center justify-center`}
      data-theme={theme}
    >
      <div className={`${styles.panel} w-full`}>
        <div className={`${styles.chrome} flex items-center justify-between`}>
          <div className={`${styles.brand} flex min-w-0 items-center`}>
            <span
              aria-hidden="true"
              className={`${styles.mark} grid shrink-0 place-items-center`}
            >
              B
            </span>
            <span>Briefly</span>
          </div>
          <div className={`${styles.controls} flex items-center`}>
            <button
              type="button"
              className={`${styles.iconButton} inline-flex items-center justify-center cursor-pointer`}
              aria-label={m.toggle_theme()}
              aria-pressed={theme === "dark"}
              onClick={toggleTheme}
            >
              <AdminIcon name={theme === "light" ? "moon" : "sun"} size={16} />
            </button>
            <Dropdown.Root>
              <Dropdown.Trigger
                className={`${styles.iconButton} inline-flex items-center justify-center cursor-pointer`}
                aria-label={m.interface_language()}
                isDisabled={!hydrated}
              >
                <AdminIcon name="globe" size={16} />
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu
                  aria-label={m.interface_language()}
                  selectionMode="single"
                  selectedKeys={new Set([selectedLocale])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const next = keys.values().next().value;
                    const normalized = canonicalizeAppLocale(next);
                    if (
                      normalized &&
                      (locales as readonly string[]).includes(normalized)
                    ) {
                      setLocale(normalized as (typeof locales)[number]);
                    }
                  }}
                >
                  {APP_LOCALE_OPTIONS.map((option) => (
                    <Dropdown.Item
                      key={option.id}
                      id={option.id}
                      textValue={option.label}
                    >
                      <Dropdown.ItemIndicator />
                      {option.id === "en"
                        ? m.switch_to_english()
                        : option.id === "zh-Hans"
                          ? m.switch_to_zh_cn()
                          : option.label}
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.Root>
          </div>
        </div>

        <div className={`${styles.body} flex flex-col`}>
          {showHeader ? (
            <header>
              <h1 className={`${styles.title} m-0`}>{title}</h1>
              {showDescription ? (
                <p className={styles.description}>{description}</p>
              ) : null}
            </header>
          ) : null}
          {children}
        </div>
      </div>

      {footerLink ? (
        <p className={`${styles.footer} text-center`}>
          Briefly ·{" "}
          <a className={`${styles.link} font-medium`} href={footerLink.href}>
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
