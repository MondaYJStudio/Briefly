import { DEFAULT_APP_LOCALE, type AppLocale } from "./registry";

export type LocalizedValues<T> = Partial<
  Record<AppLocale, T | null | undefined>
>;

export interface LocalizedValueSelection<T> {
  readonly locale: AppLocale;
  readonly value: T | null;
}

/** Selects a localized value and reports which locale supplied it. */
export function selectLocalizedValue<T>(
  values: Readonly<LocalizedValues<T>>,
  locale: AppLocale,
  fallbackLocale: AppLocale = DEFAULT_APP_LOCALE,
): LocalizedValueSelection<T> {
  const selected = values[locale];
  if (selected !== null && selected !== undefined) {
    return { locale, value: selected };
  }

  const fallback = values[fallbackLocale];
  if (fallback !== null && fallback !== undefined) {
    return { locale: fallbackLocale, value: fallback };
  }

  return { locale, value: null };
}
