import { SELF } from "cloudflare:test";
import { expect } from "vitest";

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (const [index, character] of [...decoded].entries()) {
    bytes[index] = character.charCodeAt(0);
  }
  return bytes;
}

const onePixelPng = bytesFromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
);

export async function uploadOnePixelPngAsset(
  cookie: string,
  filename: string,
): Promise<{ id: string }> {
  const body = new FormData();
  body.append("file", new File([onePixelPng], filename, { type: "image/png" }));
  const response = await SELF.fetch("http://briefly.test/api/admin/assets", {
    method: "POST",
    headers: { cookie },
    body,
  });
  expect(response.status).toBe(201);
  return response.json<{ id: string }>();
}
