import { treaty } from "@elysiajs/eden";
import { createFileRoute } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { Elysia } from "elysia";

export const api = new Elysia({
  prefix: "/api",
  aot: false,
}).get("/", () => ({
  service: "briefly" as const,
  transport: "elysia" as const,
}));

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
  .client(() => treaty<typeof api>(globalThis.location.origin).api);
