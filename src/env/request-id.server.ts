const SAFE_REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdFor(request: Request): string {
  const suppliedRequestId = request.headers.get("x-request-id");
  if (suppliedRequestId && SAFE_REQUEST_ID.test(suppliedRequestId)) {
    return suppliedRequestId;
  }
  return crypto.randomUUID();
}
