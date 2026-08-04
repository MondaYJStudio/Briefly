type LogOperation = "application" | "health";
export type LogCode =
  | "INTERNAL_ERROR"
  | "METHOD_NOT_ALLOWED"
  | "ORIGIN_MISMATCH"
  | "PUBLICATION_NOT_COMPLETED"
  | "PUBLICATION_STATE_UNCONFIRMED"
  | "RATE_LIMITED"
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

interface PublicationWorkflowFailureLog {
  requestId: string;
  operation: "preview" | "publish";
  status: 500 | 503;
  code: Extract<
    LogCode,
    | "INTERNAL_ERROR"
    | "PUBLICATION_NOT_COMPLETED"
    | "PUBLICATION_STATE_UNCONFIRMED"
  >;
}

export function logPublicationWorkflowFailure(
  log: PublicationWorkflowFailureLog,
): void {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: "publication.workflow.failed",
      requestId: log.requestId,
      operation: `publication.${log.operation}`,
      method: "POST",
      status: log.status,
      code: log.code,
    }),
  );
}
