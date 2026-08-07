import {
  APP_LOCALES,
  canonicalizeAppLocale,
  isAppLocale,
  type AppLocale,
} from "../locales/registry";
import { selectLocalizedValue } from "../locales/selection";

export const SITE_NAME_MAXIMUM_LENGTH = 120;
export const SITE_DESCRIPTION_MAXIMUM_LENGTH = 500;
export const BYLINE_NAME_MAXIMUM_LENGTH = 120;
export const BYLINE_URL_MAXIMUM_LENGTH = 2_048;
export const LANGUAGE_TAG_MAXIMUM_LENGTH = 35;

export interface Byline {
  name: string;
  url: string | null;
}

/**
 * Localized site-description values keyed by the application's canonical
 * locale registry. A null value means that a translation is missing and
 * participates in the selected-locale → English fallback chain; an empty
 * string is the explicit intentional blank.
 */
export type SiteDescriptionTranslations = Partial<
  Record<AppLocale, string | null>
>;

export interface SiteSettings {
  siteName: string;
  /**
   * Compatibility projection of the English/default description. New code
   * should read `siteDescriptions` and use `siteDescriptionForLocale`.
   */
  siteDescription: string | null;
  siteDescriptions: SiteDescriptionTranslations;
  defaultByline: Byline;
  defaultLanguage: string;
}

export interface LocalizedSiteSettings extends SiteSettings {
  /** Locale selected for the `siteDescription` projection. */
  siteDescriptionLocale: AppLocale;
}

/** Return a stable, complete map for all configured application locales. */
export function emptySiteDescriptionTranslations(): SiteDescriptionTranslations {
  return Object.fromEntries(
    APP_LOCALES.map((locale) => [locale, null]),
  ) as SiteDescriptionTranslations;
}

/**
 * Normalize a persisted or request-provided description map. Unknown keys are
 * ignored here; request validation is responsible for reporting them. Legacy
 * `zh-CN` values are folded into the canonical `zh-Hans` key by the locale
 * registry.
 */
export function normalizeSiteDescriptionTranslations(
  value: unknown,
  legacyDescription?: string | null,
): SiteDescriptionTranslations {
  const normalized = emptySiteDescriptionTranslations();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    // Persisted rows can predate request validation, so they may contain
    // differently-cased keys (or both a canonical key and an alias). Pick a
    // deterministic winner per locale instead of letting JSON insertion order
    // decide which value survives:
    //
    //   exact canonical spelling > case variant > compatibility alias.
    //
    // A lone case variant is still a valid legacy value and must not be
    // discarded. Invalid values are ignored before ranking so a malformed
    // canonical entry cannot hide a usable legacy value.
    const candidates = new Map<
      AppLocale,
      { description: string | null; rank: number; key: string }
    >();
    for (const [key, description] of entries) {
      const locale = canonicalizeAppLocale(key);
      if (!locale || !isAppLocale(locale)) continue;
      if (description !== null && typeof description !== "string") continue;

      const rank =
        key === locale ? 3 : key.toLowerCase() === locale.toLowerCase() ? 2 : 1;
      const previous = candidates.get(locale);
      if (
        !previous ||
        rank > previous.rank ||
        (rank === previous.rank && key < previous.key)
      ) {
        candidates.set(locale, { description, rank, key });
      }
    }
    for (const [locale, candidate] of candidates) {
      normalized[locale] = candidate.description;
    }
  }

  // Existing databases only have `site_description`; preserve it as English
  // when no localized value was stored yet. Do not overwrite an explicit map
  // value (including an explicit null).
  if (
    legacyDescription !== undefined &&
    normalized.en === null &&
    !hasOwnCanonicalDescription(value, "en")
  ) {
    normalized.en = legacyDescription;
  }
  return normalized;
}

function hasOwnCanonicalDescription(
  value: unknown,
  locale: AppLocale,
): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).some(
      ([key, description]) =>
        canonicalizeAppLocale(key) === locale &&
        (description === null || typeof description === "string"),
    ),
  );
}

/**
 * Resolve a description for a requested locale. The selected locale is tried
 * first, then English. Returning the actual source locale lets HTTP callers
 * set an accurate Content-Language; if neither value exists, the requested
 * locale is retained with a null description.
 */
export function siteDescriptionForLocale(
  settings: SiteSettings,
  requestedLocale: AppLocale,
): { description: string | null; locale: AppLocale } {
  const requested = canonicalizeAppLocale(requestedLocale) ?? "en";
  const descriptions = normalizeSiteDescriptionTranslations(
    settings.siteDescriptions,
    settings.siteDescription,
  );
  const selected = selectLocalizedValue(descriptions, requested);
  return { description: selected.value, locale: selected.locale };
}

export interface ArticleMetadataOverrides {
  byline?: Byline | null;
  language?: string | null;
}

export interface ResolvedArticleMetadata {
  byline: Byline;
  language: string;
}

export function resolveArticleMetadata(
  settings: SiteSettings,
  overrides: ArticleMetadataOverrides,
): ResolvedArticleMetadata {
  return {
    byline: overrides.byline ?? settings.defaultByline,
    language: overrides.language ?? settings.defaultLanguage,
  };
}
