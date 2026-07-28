import startHandler from "@tanstack/react-start/server-entry";

import { checkRuntimeHealth } from "./env/health.server";
import { logRequest, type LogCode } from "./env/logger.server";
import { requestIdFor } from "./env/request-id.server";
import {
  validateRuntimeBindings,
  type RuntimeBindings,
} from "./env/runtime.server";

type WorkerBindings = RuntimeBindings;

function authenticationRateLimitFor(
  request: Request,
  pathname: string,
): import("./auth/rate-limit.server").AuthenticationRateLimit | undefined {
  if (request.method !== "POST") return undefined;
  if (pathname === "/api/initialize") return "initialization";
  if (pathname === "/api/auth/sign-in/email") return "signIn";
  return undefined;
}

function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request, unsafeBindings, context) {
    const requestId = requestIdFor(request);
    const requestUrl = new URL(request.url);
    const operation =
      requestUrl.pathname === "/health" ? "health" : "application";
    const finishResponse = (response: Response, code?: LogCode) => {
      logRequest({
        requestId,
        operation,
        method: request.method,
        status: response.status,
        ...(code ? { code } : {}),
      });
      return response;
    };
    const configuration = validateRuntimeBindings(unsafeBindings);

    if (!configuration.ok) {
      const response = jsonResponse(
        {
          status: "error",
          code: "RUNTIME_CONFIGURATION_INVALID",
          issues: configuration.issues,
          requestId,
        },
        503,
        requestId,
      );
      return finishResponse(response, "RUNTIME_CONFIGURATION_INVALID");
    }

    if (requestUrl.origin !== configuration.bindings.APP_ORIGIN) {
      return finishResponse(
        jsonResponse(
          { status: "error", code: "ORIGIN_MISMATCH", requestId },
          421,
          requestId,
        ),
        "ORIGIN_MISMATCH",
      );
    }

    if (
      operation === "health" &&
      request.method !== "GET" &&
      request.method !== "HEAD"
    ) {
      const response = jsonResponse(
        { status: "error", code: "METHOD_NOT_ALLOWED", requestId },
        405,
        requestId,
      );
      response.headers.set("allow", "GET, HEAD");
      return finishResponse(response, "METHOD_NOT_ALLOWED");
    }

    try {
      let response: Response;
      let diagnosisCode: LogCode | undefined;
      const authenticationRateLimit = authenticationRateLimitFor(
        request,
        requestUrl.pathname,
      );
      if (authenticationRateLimit) {
        const { checkAuthenticationRateLimit } =
          await import("./auth/rate-limit.server");
        const rateLimit = await checkAuthenticationRateLimit(
          configuration.bindings.DB,
          request,
          authenticationRateLimit,
        );
        if (!rateLimit.allowed) {
          response = jsonResponse(
            { status: "error", code: "RATE_LIMITED" },
            429,
            requestId,
          );
          response.headers.set(
            "retry-after",
            String(rateLimit.retryAfterSeconds),
          );
          return finishResponse(response, "RATE_LIMITED");
        }
      }

      if (operation === "health") {
        const health = await checkRuntimeHealth(configuration.bindings);
        if (!health.ok) {
          diagnosisCode = health.code;
          if (health.code === "SCHEMA_INCOMPATIBLE") {
            response = jsonResponse(
              {
                status: "error",
                code: health.code,
                schema: { status: "incompatible" },
                requestId,
              },
              503,
              requestId,
            );
          } else {
            response = jsonResponse(
              {
                status: "error",
                code: health.code,
                storage: { [health.storage]: "unavailable" },
                requestId,
              },
              503,
              requestId,
            );
          }
        } else {
          response = jsonResponse(
            {
              status: "ok",
              service: "briefly",
              runtime: "cloudflare-workers",
              schema: {
                status: "compatible",
              },
              storage: { d1: "ready", r2: "ready" },
              requestId,
            },
            200,
            requestId,
          );
        }

        if (request.method === "HEAD") {
          response = new Response(null, response);
        }
      } else if (
        (request.method === "GET" || request.method === "HEAD") &&
        (requestUrl.pathname === "/admin" ||
          requestUrl.pathname.startsWith("/admin/"))
      ) {
        const { createAuth } = await import("./auth/auth.server");
        const session = await createAuth(configuration.bindings).api.getSession(
          {
            headers: request.headers,
            query: { disableRefresh: true },
          },
        );
        response = session
          ? withRequestId(await startHandler.fetch(request), requestId)
          : withRequestId(
              Response.redirect(
                new URL("/sign-in", configuration.bindings.APP_ORIGIN),
                302,
              ),
              requestId,
            );
        response.headers.set("cache-control", "no-store");
      } else if (requestUrl.pathname.startsWith("/api/auth/")) {
        const { createAuth } = await import("./auth/auth.server");
        response = withRequestId(
          await createAuth(configuration.bindings).handler(request),
          requestId,
        );
        response.headers.set("cache-control", "no-store");
      } else {
        response = withRequestId(await startHandler.fetch(request), requestId);
      }

      return finishResponse(response, diagnosisCode);
    } catch {
      const response = jsonResponse(
        { status: "error", code: "INTERNAL_ERROR", requestId },
        500,
        requestId,
      );
      return finishResponse(response, "INTERNAL_ERROR");
    }
  },
} satisfies ExportedHandler<WorkerBindings>;

export default worker;
