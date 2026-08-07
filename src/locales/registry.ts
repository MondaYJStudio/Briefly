/**
 * The small, dependency-free application locale registry.
 *
 * Keep this module safe to import from browser routing code. Locale
 * negotiation itself lives in `locale.ts`; this file only owns the shared
 * registry and strict persisted-locale canonicalization.
 */

export const APP_LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "en";
export const COOKIE_NAME = "PARAGLIDE_LOCALE";

export interface AppLocaleOption {
  readonly id: AppLocale;
  readonly label: string;
  readonly detail: AppLocale;
}

export const APP_LOCALE_OPTIONS = [
  { id: "en", label: "English", detail: "en" },
  { id: "zh-Hans", label: "简体中文", detail: "zh-Hans" },
  { id: "zh-Hant", label: "繁體中文", detail: "zh-Hant" },
  { id: "ja", label: "日本語", detail: "ja" },
  { id: "ko", label: "한국어", detail: "ko" },
] as const satisfies readonly AppLocaleOption[];

/** Compatibility spellings accepted at request/persistence boundaries. */
export const APP_LOCALE_ALIASES = {
  "zh-CN": "zh-Hans",
} as const satisfies Readonly<Record<string, AppLocale>>;

const APP_LOCALE_SET: ReadonlySet<string> = new Set(APP_LOCALES);

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && APP_LOCALE_SET.has(value);
}

function canonicalizeLocaleTag(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate === "*") return undefined;

  try {
    const locales = Intl.getCanonicalLocales(candidate);
    return locales.length === 1 ? locales[0] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Accepts only an explicitly supported application locale or a documented
 * compatibility alias. Broader BCP 47 matching belongs to Accept-Language
 * negotiation, not persisted manual preferences.
 */
export function canonicalizeAppLocale(value: unknown): AppLocale | undefined {
  if (typeof value !== "string") return undefined;

  const canonical = canonicalizeLocaleTag(value);
  if (!canonical) return undefined;

  const alias =
    APP_LOCALE_ALIASES[canonical as keyof typeof APP_LOCALE_ALIASES];
  if (alias) return alias;

  return APP_LOCALE_SET.has(canonical) ? (canonical as AppLocale) : undefined;
}
