import type { ArticleLifecycleProjection } from "./articles";

/**
 * The key under which two Article Content Languages count as the same
 * language inside a Translation Group: language and script after likely-subtag
 * expansion, ignoring region and every other subtag. `zh-CN` and `zh-Hans`
 * share `zh-Hans`, `en` and `en-GB` share `en-Latn`, while `zh-Hans` and
 * `zh-Hant` stay distinct. A tag whose script cannot be inferred keys by its
 * language subtag alone.
 *
 * Stored languages, the public `language` field, and the public list filter
 * keep comparing exact canonical tags; this key exists only for the group rule.
 */
export function translationLanguageKey(language: string): string {
  const locale = new Intl.Locale(language);
  // Likely subtags would turn the undetermined language into English.
  const expanded =
    locale.language === "und" && !locale.script ? locale : locale.maximize();
  return expanded.script
    ? `${expanded.language}-${expanded.script}`
    : expanded.language;
}

/** Another member of an Article's Translation Group, as Admin presents it. */
export interface ArticleTranslation {
  id: string;
  /** Draft title. */
  title: string;
  /** Draft language, else the Site Settings default. */
  language: string;
  lifecycleProjection: ArticleLifecycleProjection;
}
