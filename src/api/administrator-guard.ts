import { Elysia } from "elysia";

import { readAdministratorSession } from "../auth/administrator-session.server";
import type { RuntimeBindings } from "../env/runtime.server";

/**
 * Gates a route on an Administrator Session and hands the resolved
 * Administrator to the handler.
 *
 * A gated route declares `administrator: true` instead of restating the
 * session check, the refusal body, and the caching directive. The directive
 * covers every response from the route, including the refusal, so a route
 * needing something stricter than `no-store` declares it here rather than
 * setting a header the refusal path would miss.
 */
export function administratorGuard(getBindings: () => RuntimeBindings) {
  return new Elysia({ name: "administrator-guard" }).macro({
    administrator: (gate: boolean | { cacheControl: string }) =>
      gate
        ? {
            resolve: async ({ request, set, status }) => {
              set.headers["cache-control"] =
                gate === true ? "no-store" : gate.cacheControl;
              const { administrator } = await readAdministratorSession(
                getBindings(),
                request,
              );
              if (!administrator)
                return status(401, {
                  status: "error" as const,
                  code: "AUTHENTICATION_REQUIRED" as const,
                });
              return { administrator };
            },
          }
        : {},
  });
}
