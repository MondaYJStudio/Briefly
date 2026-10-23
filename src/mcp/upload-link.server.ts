import { uploadAsset } from "../assets/assets.server";
import type { ReadyAssetLibraryEntry } from "../assets/assets";
import { secretsMatch } from "../auth/secret.server";
import type { RuntimeBindings } from "../env/runtime.server";

/**
 * A remote MCP server cannot read the Administrator's local files. The
 * upload_asset tool therefore mints a short-lived link that an agent with
 * shell access POSTs a file to (`curl -F file=@image.png <link>`). The link
 * is an HMAC over its expiry, so nothing is stored; it can only add one
 * validated image to the Asset library and expires with the clock.
 */

export const UPLOAD_LINK_PATH_PREFIX = "/mcp/upload/";
export const UPLOAD_LINK_LIFETIME_SECONDS = 10 * 60;

const encoder = new TextEncoder();

async function sign(secret: string, expiresAt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`briefly-mcp-upload:${expiresAt}`),
  );
  return [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function summarizeAsset(asset: ReadyAssetLibraryEntry) {
  return {
    id: asset.id,
    filename: asset.originalFilename,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    byteSize: asset.byteSize,
    markdown: `![alt text](briefly-asset:${asset.id})`,
  };
}

export async function createUploadLink(
  bindings: RuntimeBindings,
  applicationOrigin: string,
  now = Date.now(),
): Promise<{ url: string; expiresAt: string }> {
  const expiresAtSeconds =
    Math.floor(now / 1000) + UPLOAD_LINK_LIFETIME_SECONDS;
  const expiry = String(expiresAtSeconds);
  const token = `${expiry}.${await sign(bindings.BETTER_AUTH_SECRET, expiry)}`;
  return {
    url: `${applicationOrigin}${UPLOAD_LINK_PATH_PREFIX}${token}`,
    expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
  };
}

async function tokenIsValid(
  bindings: RuntimeBindings,
  token: string,
  now: number,
): Promise<boolean> {
  const [expiry, signature, ...rest] = token.split(".");
  if (!expiry || !signature || rest.length > 0 || !/^\d+$/u.test(expiry))
    return false;
  if (Number(expiry) * 1000 < now) return false;
  return secretsMatch(
    signature,
    await sign(bindings.BETTER_AUTH_SECRET, expiry),
  );
}

function reply(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleUploadLinkRequest(
  request: Request,
  bindings: RuntimeBindings,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }
  const pathname = new URL(request.url).pathname;
  const token = pathname.slice(UPLOAD_LINK_PATH_PREFIX.length);
  if (!(await tokenIsValid(bindings, token, Date.now()))) {
    return reply(
      {
        status: "error",
        code: "UPLOAD_LINK_INVALID",
        message:
          "The upload link is invalid or expired. Call upload_asset again.",
      },
      401,
    );
  }

  let file: unknown;
  try {
    file = (await request.formData()).get("file");
  } catch {
    file = null;
  }
  if (!(file instanceof File)) {
    return reply(
      {
        status: "error",
        code: "UPLOAD_FILE_REQUIRED",
        message:
          "POST multipart/form-data with the image in a field named file.",
      },
      400,
    );
  }

  const result = await uploadAsset(bindings.DB, bindings.MEDIA_BUCKET, file);
  if (result.ok) return reply(summarizeAsset(result.asset), 201);
  return result.reason === "invalid"
    ? reply(
        {
          status: "error",
          code: "ASSET_UPLOAD_INVALID",
          issues: result.issues,
        },
        400,
      )
    : reply({ status: "error", code: "ASSET_UPLOAD_FAILED" }, 503);
}
