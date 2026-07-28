import { treaty } from "@elysiajs/eden";
import { createFileRoute } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";

import { api } from "../api/app.server";
import { createApiClient } from "../api/client";

const handle = ({ request }: { request: Request }) => api.fetch(request);

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
