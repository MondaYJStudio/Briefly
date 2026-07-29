import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { siteSettings } from "../db/schema";
import {
  BYLINE_NAME_MAXIMUM_LENGTH,
  BYLINE_URL_MAXIMUM_LENGTH,
  LANGUAGE_TAG_MAXIMUM_LENGTH,
  SITE_DESCRIPTION_MAXIMUM_LENGTH,
  SITE_NAME_MAXIMUM_LENGTH,
  type SiteSettings,
} from "./site-settings";

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
  .transform((language) => Intl.getCanonicalLocales(language)[0]);

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

const persistedSiteSettings = z.object({
  siteName: z.string().trim().min(1).max(SITE_NAME_MAXIMUM_LENGTH),
  siteDescription: z.string().max(SITE_DESCRIPTION_MAXIMUM_LENGTH).nullable(),
  defaultBylineName: z.string().trim().min(1).max(BYLINE_NAME_MAXIMUM_LENGTH),
  defaultBylineUrl: bylineUrl.nullable(),
  defaultLanguage: bcp47Language,
});

const siteSettingsInput = z.object({
  siteName: z
    .string()
    .trim()
    .min(1, { message: "Enter a site name." })
    .max(SITE_NAME_MAXIMUM_LENGTH, {
      message: `Use at most ${SITE_NAME_MAXIMUM_LENGTH} characters.`,
    }),
  siteDescription: z
    .string()
    .max(SITE_DESCRIPTION_MAXIMUM_LENGTH, {
      message: `Use at most ${SITE_DESCRIPTION_MAXIMUM_LENGTH} characters.`,
    })
    .nullable(),
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
});

export interface SiteSettingsValidationIssue {
  path: string;
  message: string;
}

export type UpdateSiteSettingsResult =
  | { ok: true; settings: SiteSettings }
  | { ok: false; issues: SiteSettingsValidationIssue[] };

export async function readSiteSettings(
  database: D1Database,
): Promise<SiteSettings> {
  const [row] = await drizzle(database)
    .select()
    .from(siteSettings)
    .where(eq(siteSettings.id, 1))
    .limit(1);
  const parsed = persistedSiteSettings.parse(row);
  return {
    siteName: parsed.siteName,
    siteDescription: parsed.siteDescription,
    defaultByline: {
      name: parsed.defaultBylineName,
      url: parsed.defaultBylineUrl,
    },
    defaultLanguage: parsed.defaultLanguage,
  };
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

  await drizzle(database)
    .update(siteSettings)
    .set({
      siteName: parsed.data.siteName,
      siteDescription: parsed.data.siteDescription,
      defaultBylineName: parsed.data.defaultByline.name,
      defaultBylineUrl: parsed.data.defaultByline.url,
      defaultLanguage: parsed.data.defaultLanguage,
    })
    .where(eq(siteSettings.id, 1));

  return { ok: true, settings: await readSiteSettings(database) };
}
