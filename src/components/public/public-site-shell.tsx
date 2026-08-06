import { Link } from "@tanstack/react-router";
import { type CSSProperties, type ReactNode, useState } from "react";

import { m } from "../../paraglide/messages.js";
import { getLocale, setLocale, type Locale } from "../../paraglide/runtime.js";

export type PublicTheme = "light" | "dark";

export type PublicSiteShellVariant = "home" | "interior";

/*
 * Applies the stored theme to the `.public-site` container before first
 * paint. Runs while the container's opening tag is already parsed, so the
 * attribute lands before any child is rendered — no flash, and no global
 * documentElement mutation that could disturb the admin theme.
 */
const THEME_BOOT_SCRIPT = `(function () {
  var stored = null;
  try { stored = localStorage.getItem("briefly-theme"); } catch (e) {}
  if (stored !== "light" && stored !== "dark") stored = null;
  var theme = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  var host = document.currentScript && document.currentScript.parentElement;
  if (host) host.setAttribute("data-theme", theme);
})();`;

function initialTheme(): PublicTheme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = window.localStorage.getItem("briefly-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — fall through to the media query.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function revealStyle(index: number): CSSProperties {
  return { "--i": index } as CSSProperties;
}

function SunIcon() {
  return (
    <svg
      className="icon-sun"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.3 4.3l1.6 1.6M18.1 18.1l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.3 19.7l1.6-1.6M18.1 5.9l1.6-1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      className="icon-moon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.4 14.2A8.4 8.4 0 0 1 9.8 3.6a8.4 8.4 0 1 0 10.6 10.6Z" />
    </svg>
  );
}

export function PublicSiteShell({
  siteName,
  issueLine,
  variant,
  children,
}: Readonly<{
  siteName: string;
  issueLine?: string;
  variant: PublicSiteShellVariant;
  children: ReactNode;
}>) {
  const [theme, setTheme] = useState<PublicTheme>(initialTheme);
  const dark = theme === "dark";
  const locale = getLocale();

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "light" ? "dark" : "light";
      try {
        window.localStorage.setItem("briefly-theme", next);
      } catch {
        // Persisting the preference is best-effort.
      }
      return next;
    });
  }

  function switchLocale(next: Locale) {
    if (next === locale) return;
    setLocale(next);
  }

  const name = (
    // The interior pages reserve h1 for the article title.
    <>
      {variant === "home" ? (
        <h1 className="masthead__name">{siteName}</h1>
      ) : (
        <p className="masthead__name">
          <Link to="/">{siteName}</Link>
        </p>
      )}
    </>
  );

  return (
    <div className="public-site" data-theme={theme} lang={locale}>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <div className="page">
        <header
          className={`masthead reveal${
            variant === "interior" ? " masthead--compact" : ""
          }`}
          style={revealStyle(0)}
        >
          {issueLine ? <p className="masthead__issue">{issueLine}</p> : null}
          {name}
          {variant === "home" ? (
            <nav
              className="masthead__nav"
              aria-label={m.public_main_navigation()}
            >
              <ul>
                <li>
                  <a href="#index" aria-current="page">
                    {m.articles()}
                  </a>
                </li>
                <li>
                  <a href="#how">{m.public_how_it_works_nav()}</a>
                </li>
                <li>
                  <a href="#console">{m.public_console_nav()}</a>
                </li>
              </ul>
            </nav>
          ) : null}
          <div className="masthead__controls">
            <button
              className="theme-toggle"
              type="button"
              aria-label={
                dark ? m.public_switch_to_light() : m.public_switch_to_dark()
              }
              aria-pressed={dark}
              onClick={toggleTheme}
            >
              <SunIcon />
              <MoonIcon />
            </button>
          </div>
        </header>
        <hr className="masthead__rule" aria-hidden="true" />

        {children}

        <footer className="colophon reveal" style={revealStyle(5)}>
          <div className="colophon__row">
            <p>
              {m.public_powered_by()}{" "}
              <a href="https://github.com/MondaYJStudio/Briefly">Briefly</a>
            </p>
            <label className="colophon__locale">
              <span className="sr-only">{m.interface_language()}</span>
              <select
                value={locale}
                aria-label={m.interface_language()}
                onChange={(event) =>
                  switchLocale(event.target.value as Locale)
                }
              >
                <option value="en">{m.switch_to_english()}</option>
                <option value="zh-CN">{m.switch_to_zh_cn()}</option>
              </select>
            </label>
          </div>
        </footer>
      </div>
    </div>
  );
}
