type LogOperation = "application" | "health";
export type LogCode =
  | "INTERNAL_ERROR"
  | "METHOD_NOT_ALLOWED"
  | "ORIGIN_MISMATCH"
  | "RUNTIME_CONFIGURATION_INVALID"
  | "SCHEMA_INCOMPATIBLE"
  | "STORAGE_UNAVAILABLE";

interface RequestLog {
  requestId: string;
  operation: LogOperation;
  method: string;
  status: number;
  code?: LogCode;
}

const loggedMethods = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

export function logRequest(log: RequestLog): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "http.request.completed",
      requestId: log.requestId,
      operation: log.operation,
      method: loggedMethods.has(log.method) ? log.method : "OTHER",
      status: log.status,
      ...(log.code ? { code: log.code } : {}),
    }),
  );
}
