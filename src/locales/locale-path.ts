import { canonicalizeAppLocale } from "./registry";

const RESERVED_APPLICATION_PATHS = ["/api", "/admin", "/media", "/health"];

/**
 * Decode and canonicalize a locale-looking first path segment before
 * Paraglide/TanStack route matching. URLPattern does not decode
 * `%7A%68-Hant` itself, and generated routes also include the legacy
 * `zh-CN` spelling. Non-locale paths and encoded slashes are left untouched.
 */
export function normalizeLocalePathUrl(url: URL): URL {
  const segments = url.pathname.split("/");
  const firstPathSegment = segments[1];
  if (!firstPathSegment) return url;

  try {
    const decoded = decodeURIComponent(firstPathSegment);
    const canonical = canonicalizeAppLocale(decoded);
    if (!canonical || canonical === firstPathSegment) return url;

    const normalized = new URL(url.href);
    segments[1] = canonical;
    normalized.pathname = segments.join("/");
    return normalized;
  } catch {
    return url;
  }
}

/**
 * Reserved transport/operation paths are intentionally unprefixed. Accept a
 * locale-looking prefix for routing compatibility, but keep it out of locale
 * selection so SSR and browser hydration use the cookie/header policy for
 * `/api`, `/admin`, `/media`, and `/health`.
 */
export function isReservedApplicationPath(pathname: string): boolean {
  const segments = pathname.split("/");
  const pathWithoutLocale = canonicalizeAppLocale(segments[1] ?? "")
    ? `/${segments.slice(2).join("/")}`
    : pathname;

  return RESERVED_APPLICATION_PATHS.some(
    (prefix) =>
      pathWithoutLocale === prefix ||
      pathWithoutLocale.startsWith(`${prefix}/`),
  );
}
