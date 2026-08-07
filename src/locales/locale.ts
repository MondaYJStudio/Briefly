import Negotiator from "negotiator";
import {
  APP_LOCALES,
  COOKIE_NAME,
  DEFAULT_APP_LOCALE,
  canonicalizeAppLocale,
  isAppLocale,
} from "./registry";
import type { AppLocale } from "./registry";
import {
  canonicalizeRequestedLocale,
  equivalentLocaleRanges,
  bestFitAppLocale,
  matchOrderedAppLocales,
  localeRangeMatchesAppLocale,
  localeRangeHasRegion,
  localeRangeSpecificity,
} from "./matcher";
import {
  localeFromCookieHeader,
  localeFromRequestCookie,
  localeFromRequestUrl,
} from "./request";
import {
  isReservedApplicationPath,
  normalizeLocalePathUrl,
} from "./locale-path";
import {
  selectLocalizedValue,
  type LocalizedValueSelection,
  type LocalizedValues,
} from "./selection";

export {
  APP_LOCALE_ALIASES,
  APP_LOCALE_OPTIONS,
  APP_LOCALES,
  COOKIE_NAME,
  DEFAULT_APP_LOCALE,
  canonicalizeAppLocale,
  isAppLocale,
} from "./registry";
export type { AppLocale, AppLocaleOption } from "./registry";
export {
  isReservedApplicationPath,
  normalizeLocalePathUrl,
} from "./locale-path";

export {
  localeFromCookieHeader,
  localeFromRequestCookie,
  localeFromRequestUrl,
} from "./request";
export {
  selectLocalizedValue,
  type LocalizedValueSelection,
  type LocalizedValues,
} from "./selection";

/**
 * Return configured locales ruled out by an explicit q=0 language range.
 * Negotiator filters exact available tags, but it cannot know that our
 * registry calls `zh-CN` `zh-Hans` (or that best-fit `zh-TW` is `zh-Hant`),
 * so those exclusions need one small application-level pass.
 */
function excludedLocalesFromHeader(
  header: string,
  available: readonly AppLocale[],
): ReadonlySet<AppLocale> {
  const excluded = new Set<AppLocale>();
  const ranges = new Map<
    string,
    { range: string; quality: number; index: number }
  >();
  let hasWildcard = false;
  const zeroQualityRanges: Array<{
    range: string;
    quality: number;
    index: number;
  }> = [];

  for (const [index, item] of header.split(",").entries()) {
    const [rawRange, ...parameters] = item.trim().split(";");
    const range = rawRange?.trim();
    if (!range) continue;

    const quality = qualityFromParameters(parameters);
    if (quality === 0) zeroQualityRanges.push({ range, quality, index });
    if (range === "*") {
      hasWildcard = true;
      const previous = ranges.get("*");
      if (
        previous === undefined ||
        quality > previous.quality ||
        (quality === previous.quality && index < previous.index)
      ) {
        ranges.set("*", { range, quality, index });
      }
      continue;
    }

    // Language ranges are case-insensitive. Canonicalize aliases before
    // deciding whether a duplicate preference overrides a q=0 exclusion, so
    // `zh-CN;q=0, zh-Hans;q=1` is treated as one preference.
    const key = (canonicalizeRequestedLocale(range) ?? range).toLowerCase();
    const previous = ranges.get(key);
    if (
      previous === undefined ||
      quality > previous.quality ||
      (quality === previous.quality && index < previous.index)
    ) {
      ranges.set(key, { range, quality, index });
    }
  }

  let acceptedByNegotiator = new Set<AppLocale>();
  if (hasWildcard) {
    try {
      const negotiator = new Negotiator({
        headers: { "accept-language": normalizeAcceptLanguageHeader(header) },
      });
      acceptedByNegotiator = new Set(
        negotiator
          .languages([...available])
          .map(canonicalizeRequestedLocale)
          .filter(
            (locale): locale is AppLocale =>
              locale !== undefined && available.includes(locale as AppLocale),
          ) as AppLocale[],
      );
    } catch {
      // Keep the custom alias/script pass below as a conservative fallback.
    }
  }

  // Negotiator handles q=0 correctly for the configured tags, including
  // specific ranges overriding a broader zero-quality range. Start with that
  // result when a wildcard is present, then account for aliases and script
  // best-fit pairs that it cannot see in our canonical registry
  // (zh-CN → zh-Hans, zh-TW → zh-Hant).
  if (hasWildcard) {
    for (const locale of available) {
      if (!acceptedByNegotiator.has(locale)) excluded.add(locale);
    }
  }

  function positiveOverride(
    candidate: AppLocale,
    zeroQuality: { range: string; quality: number; index: number },
  ): boolean {
    for (const { range, quality, index } of ranges.values()) {
      if (
        quality <= 0 ||
        quality < zeroQuality.quality ||
        (quality === zeroQuality.quality && index >= zeroQuality.index)
      ) {
        continue;
      }
      // Duplicate wildcard entries are the one case where both sides are
      // intentionally non-canonical ranges. A later positive wildcard with
      // a higher quality re-opens the locales rejected by an earlier `*;q=0`;
      // a wildcard must not, however, override a specific zero-quality tag.
      if (range === "*" && zeroQuality.range === "*") return true;
      const canonical = canonicalizeRequestedLocale(range);
      if (!canonical) continue;
      if (canonical.toLowerCase() === candidate.toLowerCase()) return true;
      const matchesCandidate =
        localeRangeMatchesAppLocale(canonical, candidate) ||
        bestFitAppLocale([canonical], available) === candidate;
      if (!matchesCandidate) continue;

      const positiveSpecificity = localeRangeSpecificity(canonical);
      const zeroSpecificity = localeRangeSpecificity(zeroQuality.range);
      if (positiveSpecificity > zeroSpecificity) return true;
      if (
        positiveSpecificity === zeroSpecificity &&
        (equivalentLocaleRanges(canonical, zeroQuality.range) ||
          // Several concrete regional ranges intentionally collapse to one
          // application locale (zh-CN/zh-SG → zh-Hans, zh-TW/zh-HK →
          // zh-Hant, en-US/en-GB → en). At this boundary those are the same
          // representation, even when their RFC ranges have different
          // regions. Let an equally specific positive sibling reopen the
          // representation excluded by its counterpart.
          (localeRangeHasRegion(canonical) &&
            localeRangeHasRegion(zeroQuality.range) &&
            bestFitAppLocale([canonical], available) === candidate &&
            bestFitAppLocale([zeroQuality.range], available) === candidate))
      ) {
        return true;
      }
    }
    return false;
  }

  // Iterate the original zero-quality entries rather than the de-duplicated
  // map. `zh-Hans;q=0` and the compatibility spelling `zh-CN;q=.9` canonicalize
  // to the same key, but the positive alias must still be able to override the
  // zero-quality entry.
  for (const { range, quality, index } of zeroQualityRanges) {
    const canonical = canonicalizeRequestedLocale(range);
    if (range !== "*" && !canonical) continue;

    const candidates =
      range === "*"
        ? new Set<AppLocale>(available)
        : new Set<AppLocale>(
            available.filter((candidate) =>
              localeRangeMatchesAppLocale(canonical!, candidate),
            ),
          );
    // Apply the same best-fit seam to exclusions as to positive ranges. A
    // user who marks `zh-HK;q=0` should not receive the `zh-Hant` sibling that
    // FormatJS would otherwise select for that range. Unrelated ranges still
    // produce no candidate because bestFitAppLocale uses a no-match sentinel.
    if (canonical) {
      const bestFitCandidate = bestFitAppLocale([canonical], available);
      if (bestFitCandidate) candidates.add(bestFitCandidate);
    }

    for (const candidate of candidates) {
      if (positiveOverride(candidate, { range, quality, index }))
        excluded.delete(candidate);
      else excluded.add(candidate);
    }
  }

  return excluded;
}

/**
 * Negotiator intentionally follows its historical, compact parser and only
 * recognizes the exact `;q=` spelling. HTTP's optional whitespace and
 * case-insensitive parameter names are common in real browser headers, so
 * normalize those two pieces before handing the header to Negotiator. Invalid
 * q-values are made zero-quality instead of allowing Negotiator's permissive
 * `parseFloat` behavior to promote them above valid preferences. The original
 * header is still used for q=0 compatibility exclusions above.
 */
function normalizeAcceptLanguageHeader(header: string): string {
  return header
    .split(",")
    .map((item) => {
      const [rawRange, ...parameters] = item.trim().split(";");
      const range = rawRange?.trim();
      if (!range) return "";
      // Negotiator compares its `available` list using language-range rules
      // but does not know application aliases. Canonicalize concrete ranges
      // before parsing so `zh-CN` and `zh-Hans` retain identical quality and
      // wildcard behavior. Preserve extended/invalid ranges for Negotiator to
      // handle or ignore according to its own parser.
      const normalizedRange =
        range === "*" ? range : negotiatorRangeForApplication(range);

      const normalizedParameters = parameters
        .map((parameter) => {
          const separator = parameter.indexOf("=");
          if (separator < 0) {
            const name = parameter.trim().toLowerCase();
            return name === "q" ? "q=0" : name;
          }
          const name = parameter.slice(0, separator).trim().toLowerCase();
          const value = parameter.slice(separator + 1).trim();
          if (name === "q") {
            const quality = Number(value);
            return `q=${
              Number.isFinite(quality) && quality >= 0 && quality <= 1
                ? value
                : "0"
            }`;
          }
          return `${name}=${value}`;
        })
        .filter(Boolean);
      return [normalizedRange, ...normalizedParameters].join(";");
    })
    .filter(Boolean)
    .join(",");
}

/**
 * Give Negotiator the application's likely-script representative when a
 * concrete regional range is equivalent to one of our canonical locales.
 * Negotiator does not know that zh-TW is the `zh-Hant` choice (or that en-US
 * is our bare `en` entry), so leaving the raw range makes a low-quality
 * preference look like an unmentioned wildcard candidate. Bare ranges stay
 * untouched because `zh` intentionally remains broad.
 */
function negotiatorRangeForApplication(range: string): string {
  const canonical = canonicalizeRequestedLocale(range);
  if (!canonical) return range;

  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(canonical);
  } catch {
    return canonical;
  }
  if (!locale.script && !locale.region) return canonical;

  const bestFit = bestFitAppLocale([canonical], APP_LOCALES);
  if (!bestFit) return canonical;
  // Respect an explicitly requested script when it does not describe the
  // selected registry locale; region-only ranges use likely-script data.
  if (locale.script && !localeRangeMatchesAppLocale(canonical, bestFit))
    return canonical;
  return bestFit;
}

/** Parse the last q parameter using HTTP's case-insensitive, OWS-tolerant form. */
function qualityFromParameters(parameters: readonly string[]): number {
  let qualityParameter: string | undefined;
  for (const parameter of parameters) {
    if (/^\s*q(?:\s*=|\s*$)/iu.test(parameter)) qualityParameter = parameter;
  }
  if (qualityParameter === undefined) return 1;
  const separator = qualityParameter.indexOf("=");
  if (separator < 0) return 0;
  const quality = Number(qualityParameter.slice(separator + 1).trim());
  return Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0;
}

function acceptedLanguages(
  request: Request,
  available: readonly AppLocale[],
  excludedOverride?: ReadonlySet<AppLocale>,
): string[] {
  const header = request.headers.get("accept-language");
  if (!header) return [];

  try {
    const negotiator = new Negotiator({
      headers: {
        "accept-language": normalizeAcceptLanguageHeader(header),
      },
    });
    const languages = negotiator.languages();
    const excluded =
      excludedOverride ?? excludedLocalesFromHeader(header, available);
    // `languages()` intentionally omits q=0 ranges, but it does not retain
    // that exclusion when it returns `*`. Ask Negotiator which configured
    // locales remain eligible so a zero-quality language cannot sneak back in
    // during wildcard expansion (for example `ja;q=0, *;q=.8`).
    const wildcardCandidates = negotiator
      .languages([...available])
      .map(canonicalizeRequestedLocale)
      .filter(
        (locale): locale is string =>
          locale !== undefined &&
          available.includes(locale as AppLocale) &&
          !excluded.has(locale as AppLocale),
      );

    const requested: string[] = [];
    for (const language of languages) {
      if (language === "*") {
        // FormatJS's matcher intentionally rejects `*`. Expanding it in the
        // order returned by Negotiator preserves its quality ordering. Do not
        // move the fallback to the front here: an explicit `en;q=.5` must
        // remain below an otherwise-unmatched `*;q=.8` preference.
        for (const locale of wildcardCandidates) {
          if (!requested.includes(locale)) requested.push(locale);
        }
        continue;
      }

      const canonical = canonicalizeRequestedLocale(language);
      if (
        canonical &&
        !excluded.has(canonical as AppLocale) &&
        !requested.includes(canonical)
      )
        requested.push(canonical);
    }
    return requested;
  } catch {
    return [];
  }
}

export function resolveAcceptLanguage(
  request: Request,
  available: readonly AppLocale[] = APP_LOCALES,
  fallback: AppLocale = DEFAULT_APP_LOCALE,
): AppLocale {
  // Callers normally use the shared registry. The defensive normalization
  // keeps a malformed per-surface list from producing an invalid locale; the
  // first configured locale becomes the fallback when the requested fallback
  // is not part of that subset.
  const configuredAvailable = available.filter(isAppLocale);
  const availableLocales =
    configuredAvailable.length > 0 ? configuredAvailable : APP_LOCALES;
  const availableSet: ReadonlySet<string> = new Set(availableLocales);
  const requestedFallback = isAppLocale(fallback)
    ? fallback
    : DEFAULT_APP_LOCALE;
  const effectiveFallback = availableSet.has(requestedFallback)
    ? requestedFallback
    : availableLocales[0];
  const header = request.headers.get("accept-language");
  const excluded = header
    ? excludedLocalesFromHeader(header, availableLocales)
    : new Set<AppLocale>();
  const allowedLocales = availableLocales.filter(
    (locale) => !excluded.has(locale),
  );
  const requestedLocales = acceptedLanguages(
    request,
    availableLocales,
    excluded,
  );

  // A header with no usable positive preference (including an all-q=0 list)
  // still receives the configured application fallback; the site does not
  // turn an otherwise valid request into a 406 solely because every listed
  // language was excluded.
  if (requestedLocales.length === 0) return effectiveFallback;

  // Never hand an explicitly excluded locale to best-fit. FormatJS is
  // intentionally unaware of HTTP q=0 ranges and may otherwise choose a
  // close sibling (for example zh-Hans for a zero-quality `zh` range).
  // If every configured locale is excluded, keep the matcher empty and use
  // the documented application fallback below; handing the full registry
  // back to FormatJS would resurrect a locale the header ruled out.
  if (allowedLocales.length === 0) return effectiveFallback;
  const matchAvailable = allowedLocales;
  // Negotiator has already sorted ranges by quality, specificity, and source
  // order. Match each range independently so FormatJS's distance calculation
  // cannot let a lower-quality generic range steal a higher-quality regional
  // preference merely because it happens to be a closer sibling overall.
  return matchOrderedAppLocales(
    requestedLocales,
    matchAvailable,
    effectiveFallback,
  );
}

/**
 * Resolves the locale used by site-level localized content.
 *
 * An explicit locale in the public URL wins over the persisted preference
 * cookie. Browser language negotiation is used only when neither exists.
 */
export function resolveSiteLocale(request: Request): AppLocale {
  return (
    (isReservedRequestPath(request)
      ? undefined
      : localeFromRequestUrl(request)) ??
    localeFromRequestCookie(request) ??
    resolveAcceptLanguage(request)
  );
}

/**
 * API, media, admin, and health endpoints are transport/operations paths, not
 * localized public document routes. A locale-looking prefix on one of these
 * paths is accepted for compatibility by the router, but it must not outrank
 * the explicit preference cookie or Accept-Language header.
 */
function isReservedRequestPath(request: Request): boolean {
  let pathname: string;
  try {
    pathname = normalizeLocalePathUrl(new URL(request.url)).pathname;
  } catch {
    return false;
  }

  return isReservedApplicationPath(pathname);
}

/** Adds case-insensitive Vary fields without discarding existing fields. */
export function mergeVary(
  current: string | null,
  ...fields: readonly string[]
): string {
  const existing = (current ?? "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);

  if (existing.includes("*")) return "*";

  const seen = new Set(existing.map((field) => field.toLowerCase()));
  for (const field of fields) {
    const normalized = field.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) continue;
    if (normalized === "*") return "*";
    existing.push(normalized);
    seen.add(normalized.toLowerCase());
  }

  return existing.join(", ");
}
