import { defineCustomServerStrategy } from "../paraglide/runtime.js";
import { resolveSiteLocale } from "./locale";

/**
 * Paraglide evaluates custom server strategies before its built-in strategies.
 * Resolve the complete request policy here so every server-rendered message
 * uses the same URL → persisted cookie → Accept-Language precedence as the site
 * settings API. This also keeps URL-decoded cookies and the `zh-CN`
 * compatibility alias from taking a different path through generated code.
 */
export function registerParaglideServerLocaleStrategy(): void {
  defineCustomServerStrategy("custom-accept-language", {
    getLocale(request) {
      if (!request) return undefined;
      return resolveSiteLocale(request);
    },
  });
}
