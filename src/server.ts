import startHandler from "@tanstack/react-start/server-entry";
import { paraglideMiddleware } from "./paraglide/server.js";

import { checkRuntimeHealth } from "./env/health.server";
import { logRequest, type LogCode } from "./env/logger.server";
import { requestIdFor } from "./env/request-id.server";
import {
  validateRuntimeBindings,
  type RuntimeBindings,
} from "./env/runtime.server";
import {
  applicationOriginForRequest,
  requestUsesApplicationOrigin,
} from "./env/origin.server";

import { isReservedBrieflyPublicPath } from "./public-templates/public-templates";

type WorkerBindings = RuntimeBindings;

function authenticationRateLimitFor(
  request: Request,
  pathname: string,
): import("./auth/rate-limit.server").AuthenticationRateLimit | undefined {
  if (request.method !== "POST") return undefined;
  if (pathname === "/api/initialize") return "initialization";
  if (pathname === "/api/recover") return "recovery";
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

function handleStartRequest(request: Request, bindings: RuntimeBindings) {
  // Start propagates fetch options.context to server-route handlers, although
  // the generated default entry exposes only its base context type here.
  const fetchWithContext = startHandler.fetch as unknown as (
    request: Request,
    options: { context: { bindings: RuntimeBindings } },
  ) => Promise<Response>;
  return fetchWithContext(request, { context: { bindings } });
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

    if (!requestUsesApplicationOrigin(configuration.bindings, request)) {
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
          requestUrl.pathname.startsWith("/admin/")) &&
        !["/admin/login", "/admin/setup", "/admin/recovery"].includes(
          requestUrl.pathname,
        )
      ) {
        const { createAuth } = await import("./auth/auth.server");
        const applicationOrigin = applicationOriginForRequest(
          configuration.bindings,
          request,
        );
        const session = await createAuth(
          configuration.bindings,
          applicationOrigin,
        ).api.getSession({
          headers: request.headers,
          query: { disableRefresh: true },
        });
        if (session) {
          response = withRequestId(
            await handleStartRequest(request, configuration.bindings),
            requestId,
          );
        } else {
          const { installationIsInitialized } =
            await import("./auth/initialization.server");
          const redirectPath = (await installationIsInitialized(
            configuration.bindings.DB,
          ))
            ? "/admin/login"
            : "/admin/setup";
          response = withRequestId(
            Response.redirect(new URL(redirectPath, applicationOrigin), 302),
            requestId,
          );
        }
        response.headers.set("cache-control", "no-store");
      } else if (requestUrl.pathname.startsWith("/api/auth/")) {
        const { handleAuthenticationRequest } =
          await import("./auth/http.server");
        response = withRequestId(
          await handleAuthenticationRequest(request, configuration.bindings),
          requestId,
        );
        response.headers.set("cache-control", "no-store");
      } else if (!isReservedBrieflyPublicPath(requestUrl.pathname)) {
        const { serveActivePublicTemplate } =
          await import("./public-templates/public-templates.server");
        const served = await serveActivePublicTemplate(
          configuration.bindings.DB,
          configuration.bindings.MEDIA_BUCKET,
          request,
        );
        if (served.kind === "method-not-allowed") {
          response = jsonResponse(
            { status: "error", code: "METHOD_NOT_ALLOWED" },
            405,
            requestId,
          );
          response.headers.set("allow", "GET, HEAD");
          diagnosisCode = "METHOD_NOT_ALLOWED";
        } else if (served.kind === "unavailable") {
          response = jsonResponse(
            { status: "error", code: "ACTIVE_PUBLIC_TEMPLATE_UNAVAILABLE" },
            500,
            requestId,
          );
          diagnosisCode = "INTERNAL_ERROR";
        } else if (served.kind === "response") {
          served.response.headers.set("x-request-id", requestId);
          response = served.response;
        } else {
          response = withRequestId(
            await handleStartRequest(request, configuration.bindings),
            requestId,
          );
        }
      } else {
        response = withRequestId(
          await handleStartRequest(request, configuration.bindings),
          requestId,
        );
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

export default {
  async fetch(
    request: Request,
    bindings: WorkerBindings,
    context: ExecutionContext,
  ) {
    return paraglideMiddleware(request as globalThis.Request, () =>
      worker.fetch(request as never, bindings, context),
    );
  },
} satisfies ExportedHandler<WorkerBindings>;
