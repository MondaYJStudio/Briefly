import { env } from "cloudflare:workers";
import { Elysia, t } from "elysia";

import {
  initializeAdministrator,
  installationIsInitialized,
} from "../auth/initialization.server";
import { secretsMatch } from "../auth/secret.server";
import { validateRuntimeBindings } from "../env/runtime.server";

function getBindings() {
  const configuration = validateRuntimeBindings(env);
  if (!configuration.ok) {
    throw new Error("Validated Worker bindings are unavailable");
  }
  return configuration.bindings;
}

export const api = new Elysia({
  prefix: "/api",
  aot: false,
})
  .get("/", () => ({
    service: "briefly" as const,
    transport: "elysia" as const,
  }))
  .get("/installation", async () =>
    Response.json(
      { initialized: await installationIsInitialized(getBindings().DB) },
      { headers: { "cache-control": "no-store" } },
    ),
  )
  .get("/admin/session", async ({ request }) => {
    const { createAuth } = await import("../auth/auth.server");
    const result = await createAuth(getBindings()).api.getSession({
      headers: request.headers,
      returnHeaders: true,
    });
    const headers = new Headers(result.headers);
    headers.set("cache-control", "no-store");

    if (!result.response) {
      return Response.json(
        { status: "error", code: "AUTHENTICATION_REQUIRED" },
        { status: 401, headers },
      );
    }

    return Response.json({ authenticated: true }, { headers });
  })
  .post(
    "/initialize",
    async ({ body, set, status }) => {
      const bindings = getBindings();
      set.headers["cache-control"] = "no-store";

      if (!(await secretsMatch(body.setupSecret, bindings.SETUP_SECRET))) {
        return status(403, {
          status: "error" as const,
          code: "INITIALIZATION_DENIED" as const,
        });
      }

      const result = await initializeAdministrator(bindings, body);
      if (!result.ok) {
        const code =
          result.reason === "already-initialized"
            ? "INITIALIZATION_CLOSED"
            : "INITIALIZATION_INVALID";
        return status(result.reason === "already-initialized" ? 409 : 400, {
          status: "error" as const,
          code,
        });
      }

      return status(201, { status: "ok" as const });
    },
    {
      body: t.Object({
        setupSecret: t.String(),
        email: t.String(),
        password: t.String(),
      }),
    },
  );
