import { MCP_AUTHORIZE_PATH } from "./policy";

/**
 * Every MCP authorization goes through the consent page. The plugin would
 * otherwise hand a code to any registered client the moment a signed-in
 * Administrator opens its authorization URL.
 */
export function isMcpAuthorizeRequest(request: Request, pathname: string) {
  return request.method === "GET" && pathname === MCP_AUTHORIZE_PATH;
}

export function withForcedConsent(request: Request): Request {
  const url = new URL(request.url);
  url.searchParams.set("prompt", "consent");
  return new Request(url, request);
}
