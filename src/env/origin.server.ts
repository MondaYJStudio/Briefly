import type { RuntimeBindings } from "./runtime.server";

export function applicationOriginForRequest(
  bindings: RuntimeBindings,
  request: Request,
): string {
  return bindings.APP_ORIGIN ?? new URL(request.url).origin;
}

export function requestUsesApplicationOrigin(
  bindings: RuntimeBindings,
  request: Request,
): boolean {
  return (
    !bindings.APP_ORIGIN || new URL(request.url).origin === bindings.APP_ORIGIN
  );
}
