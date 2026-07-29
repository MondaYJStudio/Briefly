import { treaty } from "@elysiajs/eden";
import { createFileRoute } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";

import { api, createApiForBindings } from "../api/app.server";
import { createApiClient } from "../api/client";
import type { RuntimeBindings } from "../env/runtime.server";

const handle = ({
  request,
  context,
}: {
  request: Request;
  context?: unknown;
}) => {
  // Supplied by the Worker through TanStack Start's request context.
  const bindings = (context as { bindings?: RuntimeBindings } | undefined)
    ?.bindings;
  if (!bindings) throw new Error("Validated Worker bindings are unavailable");
  return createApiForBindings(bindings).fetch(request);
};

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});

export const getApiClient = createIsomorphicFn()
  .server(() => treaty(api).api)
  .client(() => createApiClient(globalThis.location.origin));
