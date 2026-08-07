import { match } from "@formatjs/intl-localematcher";

import {
  APP_LOCALE_ALIASES,
  APP_LOCALES,
  DEFAULT_APP_LOCALE,
  type AppLocale,
} from "./registry";

/**
 * Canonicalize a valid language tag at a request boundary, then fold the one
 * compatibility spelling that the application deliberately keeps accepting.
 * A language range such as `zh` remains a range; it is not forced into one of
 * the concrete application locales until the best-fit matcher runs.
 */
export function canonicalizeRequestedLocale(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate === "*") return undefined;

  try {
    const canonical = Intl.getCanonicalLocales(candidate);
    if (canonical.length !== 1) return undefined;
    // `und` is a valid BCP 47 language tag, but it means “undetermined”, not
    // a request for the closest configured UI language. FormatJS treats it as
    // close to its default locale; ignore it here so a lower-quality concrete
    // preference (for example `und;q=.9,ja;q=.8`) can still win.
    if (canonical[0].toLowerCase() === "und" || canonical[0].startsWith("und-"))
      return undefined;
    return (
      APP_LOCALE_ALIASES[canonical[0] as keyof typeof APP_LOCALE_ALIASES] ??
      canonical[0]
    );
  } catch {
    return undefined;
  }
}

function localeParts(value: string): Intl.Locale | undefined {
  try {
    return new Intl.Locale(value);
  } catch {
    return undefined;
  }
}

/**
 * Return whether a language range can describe one concrete application
 * locale. The explicit-subtag checks keep a range such as `ja-JP` from
 * accidentally excluding the deliberately broad `ja` registry entry, while
 * still treating `zh-CN`/`zh-TW` as the expected script variants.
 */
export function localeRangeMatchesAppLocale(
  range: string,
  candidate: AppLocale,
): boolean {
  const canonicalRange = canonicalizeRequestedLocale(range);
  if (!canonicalRange) return false;
  if (canonicalRange.toLowerCase() === candidate.toLowerCase()) return true;

  const requested = localeParts(canonicalRange);
  const available = localeParts(candidate);
  if (!requested || !available || requested.language !== available.language)
    return false;

  // A bare language range matches all configured variants of that language.
  if (!requested.script && !requested.region) return true;

  // A concrete region/script range should not rule out a deliberately broad
  // bare registry tag (for example ja-JP must not make `ja` unacceptable).
  if (!available.script && !available.region) return false;

  const requestedMaximized = requested.maximize();
  const availableMaximized = available.maximize();

  if (
    requested.script &&
    availableMaximized.script !== requestedMaximized.script
  ) {
    return false;
  }
  if (
    requested.region &&
    availableMaximized.region !== requestedMaximized.region
  ) {
    return false;
  }
  return true;
}

/** Count the language/script/region specificity of a concrete range. */
export function localeRangeSpecificity(range: string): number {
  const canonical = canonicalizeRequestedLocale(range);
  if (!canonical) return 0;
  const locale = localeParts(canonical);
  if (!locale) return 0;
  return 1 + (locale.script ? 1 : 0) + (locale.region ? 1 : 0);
}

/** Whether a concrete language range includes an explicit region subtag. */
export function localeRangeHasRegion(range: string): boolean {
  const candidate = range.trim();
  if (!candidate || candidate === "*") return false;
  // Inspect the raw BCP 47 range before folding compatibility aliases. The
  // `zh-CN` alias is represented internally as `zh-Hans`, but it is still an
  // explicitly regional range for q=0 sibling handling.
  let canonical: string;
  try {
    const locales = Intl.getCanonicalLocales(candidate);
    if (locales.length !== 1) return false;
    canonical = locales[0];
  } catch {
    return false;
  }
  const locale = localeParts(canonical);
  return Boolean(locale?.region);
}

/**
 * Two ranges at the same specificity may be aliases for the same likely
 * locale (`zh-CN` and `zh-Hans`, or `zh-TW` and `zh-Hant`).
 */
export function equivalentLocaleRanges(left: string, right: string): boolean {
  const leftLocale = localeParts(canonicalizeRequestedLocale(left) ?? "");
  const rightLocale = localeParts(canonicalizeRequestedLocale(right) ?? "");
  if (!leftLocale || !rightLocale) return false;

  const leftMaximized = leftLocale.maximize();
  const rightMaximized = rightLocale.maximize();
  return (
    leftMaximized.language === rightMaximized.language &&
    leftMaximized.script === rightMaximized.script &&
    leftMaximized.region === rightMaximized.region
  );
}

/**
 * Best-fit match that reports no result when the requested language has no
 * relationship to the configured registry. This is useful while applying
 * q=0 rules: using the caller's fallback as FormatJS's default would make an
 * unrelated range such as `fr` appear to match every candidate.
 */
export function bestFitAppLocale(
  requestedLocales: readonly string[],
  availableLocales: readonly AppLocale[] = APP_LOCALES,
): AppLocale | undefined {
  const available = availableLocales.filter((locale): locale is AppLocale =>
    APP_LOCALES.includes(locale),
  );
  if (available.length === 0) return undefined;
  const requested = requestedLocales
    .map(canonicalizeRequestedLocale)
    .filter((locale): locale is string => locale !== undefined);
  if (requested.length === 0) return undefined;

  try {
    const resolved = match(requested, available, "__no-locale-match__", {
      algorithm: "best fit",
    });
    return available.includes(resolved as AppLocale)
      ? (resolved as AppLocale)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Match ordered preferences one range at a time.
 *
 * Passing the whole preference list to FormatJS lets its distance algorithm
 * compare a lower-priority exact language with a higher-priority best-fit
 * language. HTTP negotiation gives the order meaning, so preserve it at this
 * seam and only use FormatJS to choose a sibling for the current range.
 */
export function matchOrderedAppLocales(
  requestedLocales: readonly string[],
  availableLocales: readonly AppLocale[] = APP_LOCALES,
  fallback: AppLocale = DEFAULT_APP_LOCALE,
): AppLocale {
  const available = availableLocales.filter((locale): locale is AppLocale =>
    APP_LOCALES.includes(locale),
  );
  const effectiveAvailable = available.length > 0 ? available : APP_LOCALES;
  const effectiveFallback = effectiveAvailable.includes(fallback)
    ? fallback
    : effectiveAvailable[0];

  for (const requested of requestedLocales) {
    const resolved = bestFitAppLocale([requested], effectiveAvailable);
    if (resolved) return resolved;
  }
  return effectiveFallback;
}

/** Backwards-compatible name for ordered application-locale matching. */
export function matchAppLocale(
  requestedLocales: readonly string[],
  availableLocales: readonly AppLocale[] = APP_LOCALES,
  fallback: AppLocale = DEFAULT_APP_LOCALE,
): AppLocale {
  return matchOrderedAppLocales(requestedLocales, availableLocales, fallback);
}
