import type { CompilerOptions } from "@inlang/paraglide-js";

import { RESERVED_APPLICATION_PATHS } from "../src/locales/reserved-paths.ts";

// The admin surface is unprefixed but still localized: its Interface Locale
// comes from the cookie and Accept-Language rather than from the URL. The other
// reserved paths are transport and operation endpoints that carry no interface
// copy, so no locale is resolved for them at all.
const UNPREFIXED_BUT_LOCALIZED = "/admin";

export const paraglideCompileOptions = {
  strategy: ["custom-accept-language", "url", "cookie", "baseLocale"],
  routeStrategies: RESERVED_APPLICATION_PATHS.map((path) =>
    path === UNPREFIXED_BUT_LOCALIZED
      ? {
          match: `${path}/:path(.*)?`,
          strategy: [
            "custom-accept-language",
            "cookie",
            "baseLocale",
          ] as const satisfies CompilerOptions["strategy"],
        }
      : { match: `${path}/:path(.*)?`, exclude: true as const },
  ),
} satisfies Pick<CompilerOptions, "strategy" | "routeStrategies">;
