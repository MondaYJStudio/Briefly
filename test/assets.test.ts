import {
  SELF,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import worker from "../src/server";

const administrator = {
  email: "administrator@example.com",
  password: "correct horse battery staple",
};

function bytesFromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = new Uint8Array()): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(concatenate([typeBytes, data])));
  return chunk;
}

async function createGrayscalePng(
  width: number,
  height: number,
  targetByteSize?: number,
): Promise<Uint8Array> {
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 1;
  const raw = new Uint8Array((Math.ceil(width / 8) + 1) * height);
  const compressed = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const parts = [
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
  ];
  const minimumSize =
    parts.reduce((size, part) => size + part.byteLength, 0) + 12;
  if (targetByteSize !== undefined) {
    if (targetByteSize < minimumSize + 12)
      throw new Error("Target PNG size cannot contain a padding chunk");
    parts.push(
      pngChunk("brFy", new Uint8Array(targetByteSize - minimumSize - 12)),
    );
  }
  parts.push(pngChunk("IEND"));
  return concatenate(parts);
}

const onePixelPng = bytesFromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
);
const fourByTwoJpeg = bytesFromBase64(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAACAAQDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAE1/f//Z",
);
const fourByTwoWebp = bytesFromBase64(
  "UklGRhwAAABXRUJQVlA4TA8AAAAvA0AAAAfQv4j+ByKi/wEA",
);
const fourByFourAvif = bytesFromBase64(
  "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAiAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAEAAAABAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAqbWRhdAoJAAAAAI+JXyAIMhUQAJaAEECCAAAAAZ1MStNjMjf7f3A=",
);

function pngWithCorruptedPixelData(bytes: Uint8Array): Uint8Array {
  const corrupted = new Uint8Array(bytes);
  const view = new DataView(corrupted.buffer);
  let offset = 8;
  while (offset + 12 <= corrupted.byteLength) {
    const chunkLength = view.getUint32(offset);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength;
    const chunkType = new TextDecoder().decode(
      corrupted.subarray(offset + 4, dataOffset),
    );
    if (chunkType === "IDAT") {
      corrupted[dataOffset] ^= 0xff;
      view.setUint32(chunkEnd, crc32(corrupted.subarray(offset + 4, chunkEnd)));
      return corrupted;
    }
    offset = chunkEnd + 4;
  }
  throw new Error("Expected PNG image data");
}

const fakeJpegWithDimensions = Uint8Array.of(
  0xff,
  0xd8,
  0xff,
  0xc0,
  0x00,
  0x08,
  0x08,
  0x00,
  0x01,
  0x00,
  0x01,
  0x01,
  0xff,
  0xda,
  0x00,
  0x02,
  0xff,
  0xd9,
);
const fakeWebpWithDimensions = concatenate([
  new TextEncoder().encode("RIFF"),
  Uint8Array.of(22, 0, 0, 0),
  new TextEncoder().encode("WEBPVP8 "),
  Uint8Array.of(10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, 1, 0, 1, 0),
]);
const avifWithCorruptedPixelData = new Uint8Array(fourByFourAvif);
avifWithCorruptedPixelData.fill(0, avifWithCorruptedPixelData.length - 30);

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a session cookie");
  return setCookie.split(";", 1)[0];
}

async function initializeAndSignIn(): Promise<string> {
  expect(
    (
      await SELF.fetch("http://briefly.test/api/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          setupSecret: env.SETUP_SECRET,
          ...administrator,
        }),
      })
    ).status,
  ).toBe(201);
  return cookieFrom(
    await SELF.fetch("http://briefly.test/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://briefly.test",
      },
      body: JSON.stringify(administrator),
    }),
  );
}

async function upload(
  cookie: string,
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
  fetcher: (
    input: string,
    init: RequestInit,
  ) => Promise<Response> = SELF.fetch.bind(SELF),
): Promise<Response> {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(bytes)], filename, { type: mimeType }),
  );
  return fetcher("http://briefly.test/api/admin/assets", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
}

function bucketWithFailure(operation: "delete" | "put"): R2Bucket {
  const bucket = Object.create(env.MEDIA_BUCKET) as R2Bucket;
  Object.defineProperty(bucket, "put", {
    value:
      operation === "put"
        ? async () => {
            throw new Error("Injected R2 put failure");
          }
        : (...args: unknown[]) =>
            Reflect.apply(env.MEDIA_BUCKET.put, env.MEDIA_BUCKET, args),
  });
  Object.defineProperty(bucket, "delete", {
    value:
      operation === "delete"
        ? async () => {
            throw new Error("Injected R2 delete failure");
          }
        : (...args: unknown[]) =>
            Reflect.apply(env.MEDIA_BUCKET.delete, env.MEDIA_BUCKET, args),
  });
  return bucket;
}

async function uploadThroughWorker(
  cookie: string,
  bucket: R2Bucket,
): Promise<Response> {
  const context = createExecutionContext();
  const response = await upload(
    cookie,
    onePixelPng,
    "failure.png",
    "image/png",
    (input, init) =>
      worker.fetch(
        new Request(input, init) as Request<
          unknown,
          IncomingRequestCfProperties
        >,
        { ...env, MEDIA_BUCKET: bucket },
        context,
      ),
  );
  await waitOnExecutionContext(context);
  return response;
}

describe("private Asset media library", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM asset"),
      env.DB.prepare("DELETE FROM auth_session"),
      env.DB.prepare("DELETE FROM auth_account"),
      env.DB.prepare("DELETE FROM auth_user"),
      env.DB.prepare("DELETE FROM auth_rate_limit"),
      env.DB.prepare(
        "UPDATE installation SET state = 'uninitialized', initialized_at = NULL WHERE id = 1",
      ),
    ]);
  });

  it("uploads a verified image and exposes it only as private safe metadata and content", async () => {
    const cookie = await initializeAndSignIn();

    const uploadResponse = await upload(
      cookie,
      onePixelPng,
      "transparent.png",
      "image/png",
    );
    const responseText = await uploadResponse.text();

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.headers.get("cache-control")).toBe("no-store");
    const asset = JSON.parse(responseText) as {
      id: string;
      originalFilename: string;
      mimeType: string;
      byteSize: number;
      width: number;
      height: number;
      uploadedAt: string;
      lifecycleState: string;
      publicAssetId: string | null;
    };
    expect(asset).toMatchObject({
      id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      originalFilename: "transparent.png",
      mimeType: "image/png",
      byteSize: onePixelPng.byteLength,
      width: 1,
      height: 1,
      lifecycleState: "ready",
      publicAssetId: null,
    });
    expect(new Date(asset.uploadedAt).toISOString()).toBe(asset.uploadedAt);
    expect(responseText).not.toMatch(/object.?key|private-assets/i);

    const listResponse = await SELF.fetch(
      "http://briefly.test/api/admin/assets",
      { headers: { cookie } },
    );
    const listText = await listResponse.text();
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(listText)).toEqual({ assets: [asset] });
    expect(listText).not.toMatch(/object.?key|private-assets/i);

    const privateUrl = `http://briefly.test/media/private/${asset.id}`;
    const anonymousResponse = await SELF.fetch(privateUrl);
    expect(anonymousResponse.status).toBe(401);
    expect(anonymousResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );

    const contentResponse = await SELF.fetch(privateUrl, {
      headers: { cookie },
    });
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toBe("image/png");
    expect(contentResponse.headers.get("content-length")).toBe(
      String(onePixelPng.byteLength),
    );
    expect(contentResponse.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(contentResponse.headers.get("x-content-type-options")).toBe(
      "nosniff",
    );
    expect(new Uint8Array(await contentResponse.arrayBuffer())).toEqual(
      onePixelPng,
    );

    expect(
      (await SELF.fetch(`http://briefly.test/media/${asset.id}`)).status,
    ).toBe(404);
  }, 15_000);

  it("accepts a JPEG only when its declared MIME matches the verified bytes", async () => {
    const cookie = await initializeAndSignIn();

    const response = await upload(
      cookie,
      fourByTwoJpeg,
      "header-does-not-decide.png",
      "image/jpeg",
    );

    expect({
      status: response.status,
      body: await response.json(),
    }).toMatchObject({
      status: 201,
      body: {
        originalFilename: "header-does-not-decide.png",
        mimeType: "image/jpeg",
        byteSize: fourByTwoJpeg.byteLength,
        width: 4,
        height: 2,
        lifecycleState: "ready",
        publicAssetId: null,
      },
    });
  }, 15_000);

  it("accepts a structurally verified WebP image", async () => {
    const cookie = await initializeAndSignIn();

    const response = await upload(
      cookie,
      fourByTwoWebp,
      "tiny.webp",
      "image/webp",
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      mimeType: "image/webp",
      byteSize: fourByTwoWebp.byteLength,
      width: 4,
      height: 2,
    });
  }, 15_000);

  it("accepts an AVIF still image with verified spatial extents", async () => {
    const cookie = await initializeAndSignIn();

    const response = await upload(
      cookie,
      fourByFourAvif,
      "tiny.avif",
      "image/avif",
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      mimeType: "image/avif",
      byteSize: fourByFourAvif.byteLength,
      width: 4,
      height: 4,
    });
  }, 15_000);

  it("rejects unsupported, forged, mismatched, and structurally incomplete files", async () => {
    const cookie = await initializeAndSignIn();
    const rejectedFiles = [
      {
        name: "vector.png",
        type: "image/png",
        bytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      },
      {
        name: "animation.png",
        type: "image/png",
        bytes: bytesFromBase64(
          "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        ),
      },
      {
        name: "page.png",
        type: "image/png",
        bytes: new TextEncoder().encode("<!doctype html><h1>not an image</h1>"),
      },
      {
        name: "document.png",
        type: "image/png",
        bytes: new TextEncoder().encode("%PDF-1.7\nnot an image"),
      },
      {
        name: "archive.png",
        type: "image/png",
        bytes: Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0),
      },
      {
        name: "audio.png",
        type: "image/png",
        bytes: new TextEncoder().encode(
          "ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000",
        ),
      },
      {
        name: "video.png",
        type: "image/png",
        bytes: bytesFromBase64("AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQ=="),
      },
      {
        name: "binary.png",
        type: "image/png",
        bytes: Uint8Array.of(0, 1, 2, 3, 4, 5, 6, 7),
      },
      {
        name: "mismatch.jpg",
        type: "image/jpeg",
        bytes: onePixelPng,
      },
      {
        name: "truncated.png",
        type: "image/png",
        bytes: onePixelPng.slice(0, 33),
      },
    ];

    for (const candidate of rejectedFiles) {
      const response = await upload(
        cookie,
        candidate.bytes,
        candidate.name,
        candidate.type,
      );
      expect(response.status, candidate.name).toBe(400);
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "ASSET_UPLOAD_INVALID",
        issues: [expect.objectContaining({ path: "file" })],
      });
    }

    const library = await SELF.fetch("http://briefly.test/api/admin/assets", {
      headers: { cookie },
    });
    expect(await library.json()).toEqual({ assets: [] });
  }, 15_000);

  it("rejects valid-looking image containers whose pixels cannot be decoded", async () => {
    const cookie = await initializeAndSignIn();
    const rejectedFiles = [
      {
        name: "corrupt.png",
        type: "image/png",
        bytes: pngWithCorruptedPixelData(onePixelPng),
      },
      {
        name: "fake.jpg",
        type: "image/jpeg",
        bytes: fakeJpegWithDimensions,
      },
      {
        name: "fake.webp",
        type: "image/webp",
        bytes: fakeWebpWithDimensions,
      },
      {
        name: "corrupt.avif",
        type: "image/avif",
        bytes: avifWithCorruptedPixelData,
      },
    ];

    for (const candidate of rejectedFiles) {
      const response = await upload(
        cookie,
        candidate.bytes,
        candidate.name,
        candidate.type,
      );
      expect(response.status, candidate.name).toBe(400);
    }

    const library = await SELF.fetch("http://briefly.test/api/admin/assets", {
      headers: { cookie },
    });
    expect(await library.json()).toEqual({ assets: [] });
  }, 15_000);

  it("enforces the documented byte, edge, and total-pixel boundaries", async () => {
    const cookie = await initializeAndSignIn();
    const maximumBytes = 8 * 1024 * 1024;
    const atByteLimit = await createGrayscalePng(1, 1, maximumBytes);
    const overByteLimit = concatenate([atByteLimit, Uint8Array.of(0)]);
    const atPixelLimit = await createGrayscalePng(8_192, 2_048);
    const overPixelLimit = await createGrayscalePng(8_192, 2_049);
    const overEdgeLimit = await createGrayscalePng(8_193, 1);

    expect(atByteLimit.byteLength).toBe(maximumBytes);
    expect(
      (await upload(cookie, atByteLimit, "maximum.png", "image/png")).status,
    ).toBe(201);
    expect(
      (await upload(cookie, overByteLimit, "too-large.png", "image/png"))
        .status,
    ).toBe(400);

    const atPixelResponse = await upload(
      cookie,
      atPixelLimit,
      "maximum-pixels.png",
      "image/png",
    );
    expect(atPixelResponse.status).toBe(201);
    expect(await atPixelResponse.json()).toMatchObject({
      width: 8_192,
      height: 2_048,
    });
    for (const [filename, bytes] of [
      ["too-many-pixels.png", overPixelLimit],
      ["edge-too-wide.png", overEdgeLimit],
    ] as const) {
      expect((await upload(cookie, bytes, filename, "image/png")).status).toBe(
        400,
      );
    }
  }, 30_000);

  it("keeps identical uploads as distinct reusable Assets", async () => {
    const cookie = await initializeAndSignIn();

    const first = await (
      await upload(cookie, onePixelPng, "same.png", "image/png")
    ).json<{ id: string }>();
    const second = await (
      await upload(cookie, onePixelPng, "same.png", "image/png")
    ).json<{ id: string }>();

    expect(first.id).not.toBe(second.id);
    const response = await SELF.fetch("http://briefly.test/api/admin/assets", {
      headers: { cookie },
    });
    const library = await response.json<{
      assets: Array<{ id: string; publicAssetId: string | null }>;
    }>();
    expect(library.assets.map((asset) => asset.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(library.assets.every((asset) => asset.publicAssetId === null)).toBe(
      true,
    );
  }, 15_000);

  it("independently requires authentication for upload, list, and private content", async () => {
    const responses = await Promise.all([
      upload("", onePixelPng, "anonymous.png", "image/png"),
      SELF.fetch("http://briefly.test/api/admin/assets"),
      SELF.fetch(
        "http://briefly.test/media/private/00000000-0000-4000-8000-000000000000",
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({
        status: "error",
        code: "AUTHENTICATION_REQUIRED",
      });
    }
  });

  it("keeps an R2 upload failure diagnosable and out of the reusable library", async () => {
    const cookie = await initializeAndSignIn();

    const response = await uploadThroughWorker(
      cookie,
      bucketWithFailure("put"),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      code: "ASSET_UPLOAD_FAILED",
    });
    const failed = await env.DB.prepare(
      "SELECT object_key, lifecycle_state, failure_code FROM asset",
    ).first<{
      object_key: string;
      lifecycle_state: string;
      failure_code: string;
    }>();
    expect(failed).toMatchObject({
      lifecycle_state: "failed",
      failure_code: "R2_PUT_FAILED",
    });
    expect(await env.MEDIA_BUCKET.head(failed!.object_key)).toBeNull();
    expect(
      await (
        await SELF.fetch("http://briefly.test/api/admin/assets", {
          headers: { cookie },
        })
      ).json(),
    ).toEqual({ assets: [] });
  }, 15_000);

  it("retains a retryable failed state when D1 finalization and R2 cleanup both fail", async () => {
    const cookie = await initializeAndSignIn();
    await env.DB.prepare(
      `CREATE TRIGGER fail_asset_ready
       BEFORE UPDATE OF lifecycle_state ON asset
       WHEN NEW.lifecycle_state = 'ready'
       BEGIN
         SELECT RAISE(ABORT, 'injected Asset finalization failure');
       END`,
    ).run();
    let objectKey: string | undefined;

    try {
      const response = await uploadThroughWorker(
        cookie,
        bucketWithFailure("delete"),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        status: "error",
        code: "ASSET_UPLOAD_FAILED",
      });
      const failed = await env.DB.prepare(
        "SELECT object_key, lifecycle_state, failure_code FROM asset",
      ).first<{
        object_key: string;
        lifecycle_state: string;
        failure_code: string;
      }>();
      objectKey = failed?.object_key;
      expect(failed).toMatchObject({
        lifecycle_state: "failed",
        failure_code: "D1_FINALIZE_AND_R2_CLEANUP_FAILED",
      });
      expect(await env.MEDIA_BUCKET.head(objectKey!)).not.toBeNull();
      expect(
        await (
          await SELF.fetch("http://briefly.test/api/admin/assets", {
            headers: { cookie },
          })
        ).json(),
      ).toEqual({ assets: [] });
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_asset_ready").run();
      if (objectKey) await env.MEDIA_BUCKET.delete(objectKey);
    }
  }, 15_000);

  it("removes the private object when D1 cannot finalize a completed R2 upload", async () => {
    const cookie = await initializeAndSignIn();
    await env.DB.prepare(
      `CREATE TRIGGER fail_asset_ready_cleanup
       BEFORE UPDATE OF lifecycle_state ON asset
       WHEN NEW.lifecycle_state = 'ready'
       BEGIN
         SELECT RAISE(ABORT, 'injected Asset finalization failure');
       END`,
    ).run();

    try {
      const response = await upload(
        cookie,
        onePixelPng,
        "cleanup.png",
        "image/png",
      );

      expect(response.status).toBe(503);
      const failed = await env.DB.prepare(
        "SELECT object_key, lifecycle_state, failure_code FROM asset",
      ).first<{
        object_key: string;
        lifecycle_state: string;
        failure_code: string;
      }>();
      expect(failed).toMatchObject({
        lifecycle_state: "failed",
        failure_code: "D1_FINALIZE_FAILED",
      });
      expect(await env.MEDIA_BUCKET.head(failed!.object_key)).toBeNull();
      expect(
        await (
          await SELF.fetch("http://briefly.test/api/admin/assets", {
            headers: { cookie },
          })
        ).json(),
      ).toEqual({ assets: [] });
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_asset_ready_cleanup").run();
    }
  }, 15_000);

  it("treats a zero-row D1 finalization as failure and removes the private object", async () => {
    const cookie = await initializeAndSignIn();
    await env.DB.prepare(
      `CREATE TRIGGER ignore_asset_ready
       BEFORE UPDATE OF lifecycle_state ON asset
       WHEN NEW.lifecycle_state = 'ready'
       BEGIN
         SELECT RAISE(IGNORE);
       END`,
    ).run();

    try {
      const response = await upload(
        cookie,
        onePixelPng,
        "ignored-finalization.png",
        "image/png",
      );

      expect(response.status).toBe(503);
      const failed = await env.DB.prepare(
        "SELECT object_key, lifecycle_state, failure_code FROM asset",
      ).first<{
        object_key: string;
        lifecycle_state: string;
        failure_code: string;
      }>();
      expect(failed).toMatchObject({
        lifecycle_state: "failed",
        failure_code: "D1_FINALIZE_FAILED",
      });
      expect(await env.MEDIA_BUCKET.head(failed!.object_key)).toBeNull();
      expect(
        await (
          await SELF.fetch("http://briefly.test/api/admin/assets", {
            headers: { cookie },
          })
        ).json(),
      ).toEqual({ assets: [] });
    } finally {
      await env.DB.prepare("DROP TRIGGER ignore_asset_ready").run();
    }
  }, 15_000);

  it("presents an accessible upload, inspection, and selection surface", async () => {
    const cookie = await initializeAndSignIn();

    const response = await SELF.fetch("http://briefly.test/admin", {
      headers: { cookie },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Media library");
    expect(html).toContain("Upload verified image");
    expect(html).toContain("JPEG, PNG, WebP, or AVIF up to 8 MiB");
    expect(html).toContain("Loading Assets");
  }, 15_000);
});
