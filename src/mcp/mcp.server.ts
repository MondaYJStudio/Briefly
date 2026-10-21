import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { jsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/types.js";
import {
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
} from "better-auth/plugins";

import { createAuth } from "../auth/auth.server";
import { MCP_ENDPOINT_PATH } from "../auth/policy";
import { applicationOriginForRequest } from "../env/origin.server";
import type { RuntimeBindings } from "../env/runtime.server";
import { registerArticleTools } from "./article-tools.server";

/**
 * The remote MCP endpoint and the OAuth discovery documents MCP clients read
 * before they can call it.
 *
 * The endpoint is stateless: every POST carries its bearer token, builds a
 * fresh server, and answers with JSON. Nothing about a client is held between
 * requests, which suits a Worker and means a disconnected Connected App is
 * refused on its very next call.
 */

const SERVER_INSTRUCTIONS = `Briefly manages Articles. Each Article has one private Draft and zero or more immutable Publications; readers only see the Current Publication.

Typical flow: create_article (or get_article then update_draft) → preview_article → publish_article.
- Every save and publish names the exact Draft Version you last read; if the Draft changed meanwhile the call is refused. Re-read with get_article and retry.
- Bodies are Markdown. Do not repeat the title as a heading.
- Publishing is public immediately. Confirm with the user first.
- A translation is its own Article in the source's Translation Group: create it with create_article and translationOf. Slugs are unique site-wide, so each translation has its own slug.`;

/**
 * The SDK validates JSON Schema only for elicitation, which Briefly never
 * starts. Its default validator compiles schemas with `new Function`, which
 * workerd forbids, and the cfworker one reads `self.location` when imported,
 * which breaks the Vite dev runner. Refusing keeps a future elicitation from
 * passing unvalidated input.
 */
const elicitationUnsupported: jsonSchemaValidator = {
  getValidator: () => () => ({
    valid: false,
    data: undefined,
    errorMessage: "Elicitation is not supported by this server.",
  }),
};

/** Bearer tokens, not cookies, authorize these paths, so any origin may call them. */
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
  "access-control-max-age": "86400",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS))
    headers.set(name, value);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_ENDPOINT_PATH}`;
}

function unauthorized(origin: string): Response {
  const challenge = `Bearer resource_metadata="${protectedResourceMetadataUrl(origin)}"`;
  return withCors(
    Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32001, message: "Authentication required" },
        id: null,
      },
      { status: 401, headers: { "www-authenticate": challenge } },
    ),
  );
}

export async function handleMcpRequest(
  request: Request,
  bindings: RuntimeBindings,
): Promise<Response> {
  if (request.method === "OPTIONS")
    return withCors(new Response(null, { status: 204 }));

  const origin = applicationOriginForRequest(bindings, request);
  const token = await createAuth(bindings, origin).api.getMcpSession({
    headers: request.headers,
  });
  if (!token?.userId) return unauthorized(origin);

  // A stateless server has no stream to offer and no session to end.
  if (request.method !== "POST") {
    return withCors(
      new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } }),
    );
  }

  const server = new McpServer(
    { name: "briefly", version: "0.0.0" },
    {
      jsonSchemaValidator: elicitationUnsupported,
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerArticleTools(server, { bindings, applicationOrigin: origin });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(request));
  } finally {
    await server.close();
  }
}

/**
 * Root discovery documents. The plugin serves them under `/api/auth`, but MCP
 * clients look at the origin: the protected-resource document named by the
 * 401 challenge, then the authorization server's metadata for the issuer.
 */
export function wellKnownDocument(
  pathname: string,
): "protected-resource" | "authorization-server" | null {
  if (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname.startsWith("/.well-known/oauth-protected-resource/")
  )
    return "protected-resource";
  if (
    pathname === "/.well-known/oauth-authorization-server" ||
    pathname.startsWith("/.well-known/oauth-authorization-server/") ||
    pathname === "/.well-known/openid-configuration"
  )
    return "authorization-server";
  return null;
}

export async function handleWellKnownRequest(
  request: Request,
  bindings: RuntimeBindings,
  document: "protected-resource" | "authorization-server",
): Promise<Response> {
  if (request.method === "OPTIONS")
    return withCors(new Response(null, { status: 204 }));
  const auth = createAuth(
    bindings,
    applicationOriginForRequest(bindings, request),
  );
  const handler =
    document === "protected-resource"
      ? oAuthProtectedResourceMetadata(auth)
      : oAuthDiscoveryMetadata(auth);
  return withCors(await handler(request));
}
