import { createFileRoute } from "@tanstack/react-router";

import { headPublicAsset, readPublicAsset } from "../assets/assets.server";
import type { RuntimeBindings } from "../env/runtime.server";

const immutableMediaHeaders = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=31536000, immutable",
  "content-disposition": "inline",
  "cross-origin-resource-policy": "cross-origin",
  "x-content-type-options": "nosniff",
};

const missingMediaHeaders = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
  "cross-origin-resource-policy": "cross-origin",
  "x-content-type-options": "nosniff",
};

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

  const publicAssetId = new URL(request.url).pathname.split("/").at(-1) ?? "";
  const content =
    request.method === "HEAD"
      ? await headPublicAsset(bindings.DB, bindings.MEDIA_BUCKET, publicAssetId)
      : await readPublicAsset(
          bindings.DB,
          bindings.MEDIA_BUCKET,
          publicAssetId,
        );
  if (!content) {
    return request.method === "HEAD"
      ? new Response(null, { status: 404, headers: missingMediaHeaders })
      : Response.json(
          { status: "error", code: "ASSET_NOT_FOUND" },
          { status: 404, headers: missingMediaHeaders },
        );
  }

  return new Response(
    request.method === "HEAD" ? null : (content.object as R2ObjectBody).body,
    {
      headers: {
        ...immutableMediaHeaders,
        "content-length": String(content.asset.byteSize),
        "content-type": content.asset.mimeType,
      },
    },
  );
}

export const Route = createFileRoute("/media/$publicAssetId")({
  server: { handlers: { GET: handle, HEAD: handle } },
});
