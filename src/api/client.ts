import { treaty } from "@elysiajs/eden";

import type { api } from "./app.server";

export function createApiClient(origin: string, fetcher: typeof fetch = fetch) {
  return treaty<typeof api>(origin, { fetcher }).api;
}
