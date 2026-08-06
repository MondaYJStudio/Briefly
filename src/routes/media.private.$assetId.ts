import { createFileRoute } from "@tanstack/react-router";

import { readPrivateAsset } from "../assets/assets.server";
import { createAuth } from "../auth/auth.server";
import { applicationOriginForRequest } from "../env/origin.server";
import type { RuntimeBindings } from "../env/runtime.server";

async function handle({
  request,
  context,
}: {
  request: Request;
  context?: unknown;
}): Promise<Response> {
  const bindings = (context as { bindings?: RuntimeBindings } | undefined)
    ?.bindings;
  if (!bindings) throw new Error("Validated Worker bindings are unavailable");

  const privateHeaders = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  const session = await createAuth(
    bindings,
    applicationOriginForRequest(bindings, request),
  ).api.getSession({
    headers: request.headers,
    query: { disableRefresh: true },
  });
  if (!session) {
    return Response.json(
      { status: "error", code: "AUTHENTICATION_REQUIRED" },
      { status: 401, headers: privateHeaders },
    );
  }

  const assetId = new URL(request.url).pathname.split("/").at(-1) ?? "";
  const content = await readPrivateAsset(
    bindings.DB,
    bindings.MEDIA_BUCKET,
    assetId,
  );
  if (!content) {
    return Response.json(
      { status: "error", code: "ASSET_NOT_FOUND" },
      { status: 404, headers: privateHeaders },
    );
  }

  return new Response(request.method === "HEAD" ? null : content.object.body, {
    headers: {
      ...privateHeaders,
      "content-length": String(content.asset.byteSize),
      "content-type": content.asset.mimeType,
    },
  });
}

export const Route = createFileRoute("/media/private/$assetId")({
  server: { handlers: { GET: handle, HEAD: handle } },
});
