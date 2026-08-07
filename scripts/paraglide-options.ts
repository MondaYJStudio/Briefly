import type { CompilerOptions } from "@inlang/paraglide-js";

export const paraglideCompileOptions = {
  strategy: ["custom-accept-language", "url", "cookie", "baseLocale"],
  routeStrategies: [
    {
      match: "/admin/:path(.*)?",
      strategy: ["custom-accept-language", "cookie", "baseLocale"],
    },
    { match: "/api/:path(.*)?", exclude: true },
    { match: "/media/:path(.*)?", exclude: true },
    { match: "/health/:path(.*)?", exclude: true },
  ],
} satisfies Pick<CompilerOptions, "strategy" | "routeStrategies">;
