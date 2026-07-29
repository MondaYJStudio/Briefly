export const SITE_NAME_MAXIMUM_LENGTH = 120;
export const SITE_DESCRIPTION_MAXIMUM_LENGTH = 500;
export const BYLINE_NAME_MAXIMUM_LENGTH = 120;
export const BYLINE_URL_MAXIMUM_LENGTH = 2_048;
export const LANGUAGE_TAG_MAXIMUM_LENGTH = 35;

export interface Byline {
  name: string;
  url: string | null;
}

export interface SiteSettings {
  siteName: string;
  siteDescription: string | null;
  defaultByline: Byline;
  defaultLanguage: string;
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
