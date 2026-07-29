import type { RuntimeBindings } from "../env/runtime.server";
import { createAuth } from "./auth.server";
import { changeAdministratorPassword } from "./credentials.server";

function passwordChangeDenied(status: 400 | 401 | 403): Response {
  const code =
    status === 401 ? "AUTHENTICATION_REQUIRED" : "PASSWORD_CHANGE_DENIED";
  return Response.json(
    { status: "error", code },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function handleAuthenticationRequest(
  request: Request,
  bindings: RuntimeBindings,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method !== "POST" || pathname !== "/api/auth/change-password") {
    return createAuth(bindings).handler(request);
  }
  if (request.headers.get("origin") !== bindings.APP_ORIGIN) {
    return passwordChangeDenied(403);
  }

  let body: { currentPassword?: unknown; newPassword?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {}
  if (
    typeof body?.currentPassword !== "string" ||
    typeof body?.newPassword !== "string"
  ) {
    return passwordChangeDenied(400);
  }

  const result = await changeAdministratorPassword(bindings, request.headers, {
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
  });
  if (!result.ok) {
    return passwordChangeDenied(
      result.reason === "authentication-required" ? 401 : 400,
    );
  }

  return Response.json(
    { status: "ok" },
    { headers: { "cache-control": "no-store" } },
  );
}
