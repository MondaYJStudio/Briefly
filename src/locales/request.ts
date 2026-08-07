import { canonicalizeAppLocale, COOKIE_NAME, type AppLocale } from "./registry";
import { normalizeLocalePathUrl } from "./locale-path";

export function localeFromRequestUrl(request: Request): AppLocale | undefined {
  const firstPathSegment = normalizeLocalePathUrl(
    new URL(request.url),
  ).pathname.split("/")[1];
  if (!firstPathSegment) return undefined;

  try {
    // URL matching is case-insensitive; use the same canonicalization here so
    // the public resolver and the i18n middleware cannot disagree about
    // `/ZH-HANS/...` or `/zh-cn/...`.
    return canonicalizeAppLocale(firstPathSegment);
  } catch {
    return undefined;
  }
}

function decodeCookieValue(value: string): string {
  const unquoted =
    value.length >= 2 && value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;

  try {
    return decodeURIComponent(unquoted);
  } catch {
    return unquoted;
  }
}

/** Resolve the shared locale cookie from a raw Cookie header. */
export function localeFromCookieHeader(
  cookieHeader: string | null | undefined,
  cookieName = COOKIE_NAME,
): AppLocale | undefined {
  if (!cookieHeader) return undefined;

  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;

    const name = pair.slice(0, separator).trim();
    if (name !== cookieName) continue;

    const locale = canonicalizeAppLocale(
      decodeCookieValue(pair.slice(separator + 1).trim()),
    );
    if (locale) return locale;
  }

  return undefined;
}

export function localeFromRequestCookie(
  request: Request,
  cookieName = COOKIE_NAME,
): AppLocale | undefined {
  return localeFromCookieHeader(request.headers.get("cookie"), cookieName);
}
