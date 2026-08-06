import type { CompilerOptions } from "@inlang/paraglide-js";

export const paraglideCompileOptions = {
  strategy: ["url", "cookie", "preferredLanguage", "baseLocale"],
  routeStrategies: [
    {
      match: "/admin/:path(.*)?",
      strategy: ["cookie", "preferredLanguage", "baseLocale"],
    },
    { match: "/api/:path(.*)?", exclude: true },
    { match: "/media/:path(.*)?", exclude: true },
    { match: "/health", exclude: true },
  ],
} satisfies Pick<CompilerOptions, "strategy" | "routeStrategies">;
