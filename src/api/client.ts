import { treaty } from "@elysiajs/eden";

import { getLocale } from "../paraglide/runtime.js";
import type { api } from "./app.server";

export function createApiClient(origin: string, fetcher: typeof fetch = fetch) {
  return treaty<typeof api>(origin, {
    fetcher,
    // Client-side API calls use the same interface locale as the hydrated
    // shell. This matters for an unprefixed `/api/site` request after a
    // direct visit to a locale-prefixed page, where the URL itself is not
    // part of the API request.
    headers: () => {
      try {
        return { "accept-language": getLocale() };
      } catch {
        return {};
      }
    },
  }).api;
}
