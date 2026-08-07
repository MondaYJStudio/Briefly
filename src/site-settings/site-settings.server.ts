import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import {
  APP_LOCALES,
  canonicalizeAppLocale,
  isAppLocale,
  type AppLocale,
} from "../locales/registry";
import { siteSettings } from "../db/schema";
import {
  BYLINE_NAME_MAXIMUM_LENGTH,
  BYLINE_URL_MAXIMUM_LENGTH,
  LANGUAGE_TAG_MAXIMUM_LENGTH,
  SITE_DESCRIPTION_MAXIMUM_LENGTH,
  SITE_NAME_MAXIMUM_LENGTH,
  emptySiteDescriptionTranslations,
  normalizeSiteDescriptionTranslations,
  siteDescriptionForLocale,
  type SiteDescriptionTranslations,
  type SiteSettings,
} from "./site-settings";

function canonicalLanguageTag(language: string): string {
  // Article/Publications keep their own content-language metadata. It is a
  // valid BCP 47 tag, but it is not silently rewritten to an application UI
  // alias (for example zh-CN → zh-Hans).
  try {
    return Intl.getCanonicalLocales(language)[0] ?? language;
  } catch {
    return language;
  }
}

const bcp47Language = z
  .string()
  .max(LANGUAGE_TAG_MAXIMUM_LENGTH, {
    message: `Use at most ${LANGUAGE_TAG_MAXIMUM_LENGTH} characters.`,
  })
  .superRefine((language, context) => {
    try {
      if (Intl.getCanonicalLocales(language).length !== 1) throw new Error();
    } catch {
      context.addIssue({
        code: "custom",
        message: "Use a valid BCP 47 language tag, such as en or zh-Hans.",
      });
    }
  })
  .transform(canonicalLanguageTag);

const bylineUrl = z
  .string()
  .max(BYLINE_URL_MAXIMUM_LENGTH, {
    message: `Use at most ${BYLINE_URL_MAXIMUM_LENGTH} characters.`,
  })
  .refine(URL.canParse, { message: "Enter a valid URL." })
  .refine(
    (url) =>
      URL.canParse(url) && ["http:", "https:"].includes(new URL(url).protocol),
    { message: "Use an HTTP or HTTPS URL." },
  )
  .transform((url) => new URL(url).toString());

const descriptionValue = z
  .string()
  .max(SITE_DESCRIPTION_MAXIMUM_LENGTH, {
    message: `Use at most ${SITE_DESCRIPTION_MAXIMUM_LENGTH} characters.`,
  })
  .nullable();

/** Validate keys and values before they are folded to canonical locale keys. */
const siteDescriptionsInput = z
  .record(z.string(), descriptionValue)
  .superRefine((descriptions, context) => {
    const seen = new Map<AppLocale, string>();
    for (const [locale, value] of Object.entries(descriptions)) {
      const canonical = canonicalizeAppLocale(locale);
      if (!canonical || !isAppLocale(canonical)) {
        context.addIssue({
          code: "custom",
          path: [locale],
          message: `Use one of the supported locales: ${APP_LOCALES.join(", ")}.`,
        });
      } else if (seen.has(canonical) && seen.get(canonical) !== locale) {
        context.addIssue({
          code: "custom",
          path: [locale],
          message: `Use either ${canonical} or its compatibility alias, not both.`,
        });
      } else {
        seen.set(canonical, locale);
      }
      // `descriptionValue` performs the length check. Keeping this branch
      // explicit makes the schema resilient if the value schema changes.
      if (value !== null && typeof value !== "string") {
        context.addIssue({
          code: "custom",
          path: [locale],
          message: "Use a string or null.",
        });
      }
    }
  })
  .nullable();

function persistedDescriptions(value: unknown): unknown {
  let parsed: unknown = value;
  // Older Drizzle/D1 runtimes can return a JSON-mode text column as a string;
  // tolerate that representation during rolling deployments.
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  return parsed;
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

const persistedSiteSettings = z.object({
  siteName: z.string().trim().min(1).max(SITE_NAME_MAXIMUM_LENGTH),
  siteDescription: descriptionValue,
  siteDescriptions: z.unknown().optional().nullable(),
  defaultBylineName: z.string().trim().min(1).max(BYLINE_NAME_MAXIMUM_LENGTH),
  defaultBylineUrl: bylineUrl.nullable(),
  defaultLanguage: bcp47Language,
});

const siteSettingsInput = z
  .object({
    siteName: z
      .string()
      .trim()
      .min(1, { message: "Enter a site name." })
      .max(SITE_NAME_MAXIMUM_LENGTH, {
        message: `Use at most ${SITE_NAME_MAXIMUM_LENGTH} characters.`,
      }),
    // `siteDescription` remains accepted for clients from before localized
    // descriptions. When both fields are sent, map entries win for their
    // keys and this scalar seeds English only when the map omitted that key.
    siteDescription: descriptionValue.optional(),
    siteDescriptions: siteDescriptionsInput.optional(),
    defaultByline: z.object({
      name: z
        .string()
        .trim()
        .min(1, { message: "Enter a default Byline name." })
        .max(BYLINE_NAME_MAXIMUM_LENGTH, {
          message: `Use at most ${BYLINE_NAME_MAXIMUM_LENGTH} characters.`,
        }),
      url: bylineUrl.nullable(),
    }),
    defaultLanguage: bcp47Language,
  })
  .refine(
    (input) =>
      input.siteDescription !== undefined ||
      input.siteDescriptions !== undefined,
    {
      path: ["siteDescriptions"],
      message: "Provide siteDescriptions or the legacy siteDescription field.",
    },
  );

export interface SiteSettingsValidationIssue {
  path: string;
  message: string;
}

export type UpdateSiteSettingsResult =
  | { ok: true; settings: SiteSettings }
  | { ok: false; issues: SiteSettingsValidationIssue[] };

/** Return a complete map while retaining values from a legacy scalar column. */
function descriptionsFromPersistedRow(
  row: Record<string, unknown>,
): SiteDescriptionTranslations {
  const persisted = persistedDescriptions(row.siteDescriptions);
  // The JSON map is authoritative for every key it explicitly owns. A partial
  // map from a rolling deployment may contain only a non-English translation;
  // in that case the legacy scalar still seeds the missing English slot. The
  // normalizer distinguishes a missing `en` key from an explicit `en: null`,
  // so a deliberate deletion is never overwritten by stale scalar data.
  const legacyDescription =
    typeof row.siteDescription === "string" || row.siteDescription === null
      ? row.siteDescription
      : undefined;
  const descriptions = normalizeSiteDescriptionTranslations(
    persisted,
    legacyDescription,
  );
  // During a rolling deployment, an old Worker can update only the legacy
  // scalar after migration 0012 has populated the JSON map. New writes mirror
  // both fields, so a mismatch is the reliable signal that the scalar is the
  // newer compatibility write; prefer it for the English projection while
  // retaining every non-English map entry.
  if (
    legacyDescription !== undefined &&
    hasOwnCanonicalDescription(persisted, "en") &&
    descriptions.en !== legacyDescription
  ) {
    descriptions.en = legacyDescription;
  }
  return descriptions;
}

export async function readSiteSettings(
  database: D1Database,
): Promise<SiteSettings> {
  const [row] = await drizzle(database)
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.id, 1))
    .limit(1);
  const parsed = persistedSiteSettings.parse(row);
  const descriptions = descriptionsFromPersistedRow(
    row as unknown as Record<string, unknown>,
  );
  return {
    siteName: parsed.siteName,
    // Keep the scalar projection stable for existing consumers. English is
    // the canonical compatibility projection, even when it is explicitly
    // null and another locale has content.
    siteDescription: descriptions.en ?? null,
    siteDescriptions: descriptions,
    defaultByline: {
      name: parsed.defaultBylineName,
      url: parsed.defaultBylineUrl,
    },
    defaultLanguage: parsed.defaultLanguage,
  };
}

function normalizeInputDescriptions(
  input: z.infer<typeof siteSettingsInput>,
  current: SiteSettings,
): SiteDescriptionTranslations {
  if (input.siteDescriptions !== undefined) {
    // Treat an object map as a patch. This keeps a rolling-deployment client
    // that knows only one translation from erasing translations added by a
    // newer client. `null` remains an explicit delete for that locale; a
    // top-level null intentionally clears the complete map.
    if (input.siteDescriptions === null) {
      const cleared = emptySiteDescriptionTranslations();
      if (input.siteDescription !== undefined)
        cleared.en = input.siteDescription;
      return cleared;
    }

    const next = normalizeSiteDescriptionTranslations(
      current.siteDescriptions,
      current.siteDescription,
    );
    let hasEnglish = false;
    for (const [key, description] of Object.entries(input.siteDescriptions)) {
      const locale = canonicalizeAppLocale(key);
      if (!locale || !isAppLocale(locale)) continue;
      next[locale] = description;
      if (locale === "en") hasEnglish = true;
    }
    // The legacy scalar is still useful when a compatibility client sends a
    // partial map without an English key. An explicit map `en: null` wins.
    if (!hasEnglish && input.siteDescription !== undefined)
      next.en = input.siteDescription;
    return next;
  }
  if (input.siteDescription !== undefined) {
    // A legacy-only update changes the English projection and intentionally
    // leaves existing translations for other locales untouched.
    return {
      ...current.siteDescriptions,
      en: input.siteDescription,
    };
  }
  return current.siteDescriptions;
}

export async function updateSiteSettings(
  database: D1Database,
  input: unknown,
): Promise<UpdateSiteSettingsResult> {
  const parsed = siteSettingsInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const current = await readSiteSettings(database);
  const descriptions = normalizeInputDescriptions(parsed.data, current);

  await drizzle(database)
    .update(siteSettings)
    .set({
      siteName: parsed.data.siteName,
      // Mirror the English value for old binaries/SQL clients. The map is the
      // authoritative representation for localized consumers.
      siteDescription: descriptions.en ?? null,
      siteDescriptions: descriptions,
      defaultBylineName: parsed.data.defaultByline.name,
      defaultBylineUrl: parsed.data.defaultByline.url,
      defaultLanguage: parsed.data.defaultLanguage,
    })
    .where(eq(siteSettings.id, 1));

  return { ok: true, settings: await readSiteSettings(database) };
}

/**
 * Return a response-shaped settings object with a selected description. This
 * is kept server-side so API handlers and future server routes share exactly
 * the same fallback semantics.
 */
export function localizedSiteSettings(
  settings: SiteSettings,
  locale: AppLocale,
): SiteSettings & { siteDescriptionLocale: AppLocale } {
  const descriptions = normalizeSiteDescriptionTranslations(
    settings.siteDescriptions,
    settings.siteDescription,
  );
  const selected = siteDescriptionForLocale(settings, locale);
  return {
    ...settings,
    siteDescription: selected.description,
    siteDescriptions: descriptions,
    siteDescriptionLocale: selected.locale,
  };
}
