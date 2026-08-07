/**
 * Public site-description locale boundary.
 *
 * Domain callers should import `resolveSiteLocale(request)` from this module
 * instead of knowing which header parser or matching algorithm is underneath.
 * The registry and policy live in `src/locales/registry.ts` and
 * `src/locales/locale.ts` so Paraglide and Site Settings cannot drift apart.
 * Keep this boundary intentionally narrow: site business code asks one
 * request-level question and does not import Negotiator, the matcher, or
 * separate URL/cookie/header resolvers.
 */
export { resolveSiteLocale } from "../locales/locale";

export type { AppLocale as SiteDescriptionLocale } from "../locales/registry";
