/**
 * The application paths that never carry a locale prefix.
 *
 * Routing, locale selection, and the build-time Paraglide route strategies all
 * read this one list, so a reserved path is added in a single place and the
 * URLs Briefly serves cannot disagree with the routes Paraglide generates.
 *
 * Keep this module free of imports: the Paraglide compile options load it
 * directly from Node before the generated runtime exists.
 */
export const RESERVED_APPLICATION_PATHS = [
  "/admin",
  "/api",
  "/media",
  "/health",
] as const;
