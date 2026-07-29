import { z } from "zod";

import {
  ASSET_MAXIMUM_BYTE_SIZE,
  ASSET_MAXIMUM_DIMENSION,
  ASSET_MAXIMUM_PIXEL_COUNT,
  ASSET_ORIGINAL_FILENAME_MAXIMUM_LENGTH,
  type Asset,
  type AssetMimeType,
  type AssetValidationIssue,
} from "./assets";
import { decodeImage } from "./image-decoder.server";

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const crc32Table = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

interface VerifiedImage {
  mimeType: AssetMimeType;
  width: number;
  height: number;
}

interface ReadyAssetRow {
  id: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  width: number;
  height: number;
  uploaded_at: number;
  lifecycle_state: string;
  public_asset_id: string | null;
}

interface PrivateAssetRow extends ReadyAssetRow {
  object_key: string;
}

export type UploadAssetResult =
  | { ok: true; asset: Asset }
  | { ok: false; reason: "invalid"; issues: AssetValidationIssue[] }
  | { ok: false; reason: "storage-failed" };

function readyAssetFromRow(row: ReadyAssetRow): Asset {
  return z
    .object({
      id: z.string().uuid(),
      original_filename: z.string(),
      mime_type: z.enum([
        "image/avif",
        "image/jpeg",
        "image/png",
        "image/webp",
      ]),
      byte_size: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      uploaded_at: z.number().int(),
      lifecycle_state: z.literal("ready"),
      public_asset_id: z.string().uuid().nullable(),
    })
    .transform((value) => ({
      id: value.id,
      originalFilename: value.original_filename,
      mimeType: value.mime_type,
      byteSize: value.byte_size,
      width: value.width,
      height: value.height,
      uploadedAt: new Date(value.uploaded_at).toISOString(),
      lifecycleState: value.lifecycle_state,
      publicAssetId: value.public_asset_id,
    }))
    .parse(row);
}

function inspectPng(bytes: Uint8Array): VerifiedImage | null {
  if (
    bytes.byteLength < 33 ||
    pngSignature.some((value, index) => bytes[index] !== value)
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let dimensions: Pick<VerifiedImage, "width" | "height"> | null = null;
  let hasImageData = false;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) return null;
    const chunkLength = view.getUint32(offset);
    const chunkType = String.fromCharCode(
      ...bytes.subarray(offset + 4, offset + 8),
    );
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength;
    if (
      !/^[A-Za-z]{4}$/u.test(chunkType) ||
      chunkEnd + 4 > bytes.byteLength ||
      pngChunkCrc32(bytes, offset + 4, chunkEnd) !== view.getUint32(chunkEnd)
    ) {
      return null;
    }

    if (chunkType === "IHDR") {
      if (offset !== 8 || chunkLength !== 13 || dimensions) return null;
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const allowedBitDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !allowedBitDepths[colorType]?.includes(bitDepth) ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        ![0, 1].includes(bytes[dataOffset + 12])
      ) {
        return null;
      }
      dimensions = {
        width: view.getUint32(dataOffset),
        height: view.getUint32(dataOffset + 4),
      };
    } else if (chunkType === "IDAT") {
      if (!dimensions || chunkLength === 0) return null;
      hasImageData = true;
    } else if (chunkType === "IEND") {
      return dimensions &&
        hasImageData &&
        chunkLength === 0 &&
        chunkEnd + 4 === bytes.byteLength
        ? { mimeType: "image/png", ...dimensions }
        : null;
    } else if (chunkType[0] === chunkType[0].toUpperCase()) {
      if (chunkType !== "PLTE") return null;
    }
    offset = chunkEnd + 4;
  }
  return null;
}

function pngChunkCrc32(
  bytes: Uint8Array,
  startOffset: number,
  endOffset: number,
): number {
  let crc = 0xffffffff;
  for (let offset = startOffset; offset < endOffset; offset += 1) {
    crc = crc32Table[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectJpeg(bytes: Uint8Array): VerifiedImage | null {
  if (
    bytes.byteLength < 12 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let dimensions: Pick<VerifiedImage, "width" | "height"> | null = null;
  while (offset < bytes.byteLength - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0x00 || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength - 2) return null;

    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength - 2)
      return null;
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) return null;
      dimensions = {
        height: view.getUint16(offset + 3),
        width: view.getUint16(offset + 5),
      };
    }
    if (marker === 0xda) {
      return dimensions ? { mimeType: "image/jpeg", ...dimensions } : null;
    }
    offset += segmentLength;
  }
  return null;
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function inspectWebp(bytes: Uint8Array): VerifiedImage | null {
  if (
    bytes.byteLength < 20 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== bytes.byteLength - 8) return null;

  let offset = 12;
  let dimensions: Pick<VerifiedImage, "width" | "height"> | null = null;
  let hasImageData = false;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) return null;
    const chunkType = String.fromCharCode(
      ...bytes.subarray(offset, offset + 4),
    );
    const chunkLength = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength;
    if (chunkEnd > bytes.byteLength) return null;

    if (chunkType === "VP8 ") {
      if (
        chunkLength < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        return null;
      }
      dimensions = {
        width: view.getUint16(dataOffset + 6, true) & 0x3fff,
        height: view.getUint16(dataOffset + 8, true) & 0x3fff,
      };
      hasImageData = true;
    } else if (chunkType === "VP8L") {
      if (chunkLength < 5 || bytes[dataOffset] !== 0x2f) return null;
      const packed = view.getUint32(dataOffset + 1, true);
      dimensions = {
        width: (packed & 0x3fff) + 1,
        height: ((packed >>> 14) & 0x3fff) + 1,
      };
      hasImageData = true;
    } else if (chunkType === "VP8X") {
      if (chunkLength !== 10 || dimensions) return null;
      dimensions = {
        width: uint24LittleEndian(bytes, dataOffset + 4) + 1,
        height: uint24LittleEndian(bytes, dataOffset + 7) + 1,
      };
    } else if (chunkType === "ANMF") {
      hasImageData = true;
    }

    offset = chunkEnd + (chunkLength % 2);
  }
  return offset === bytes.byteLength && dimensions && hasImageData
    ? { mimeType: "image/webp", ...dimensions }
    : null;
}

interface IsoBox {
  type: string;
  dataOffset: number;
  endOffset: number;
}

function readIsoBoxes(
  bytes: Uint8Array,
  startOffset: number,
  endOffset: number,
): IsoBox[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: IsoBox[] = [];
  let offset = startOffset;
  while (offset < endOffset) {
    if (offset + 8 > endOffset) return null;
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > endOffset) return null;
      const extendedSize = view.getBigUint64(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = endOffset - offset;
    }
    if (size < headerSize || offset + size > endOffset) return null;
    boxes.push({
      type,
      dataOffset: offset + headerSize,
      endOffset: offset + size,
    });
    offset += size;
  }
  return offset === endOffset ? boxes : null;
}

function inspectAvif(bytes: Uint8Array): VerifiedImage | null {
  const topLevel = readIsoBoxes(bytes, 0, bytes.byteLength);
  if (!topLevel) return null;
  const fileType = topLevel.find((box) => box.type === "ftyp");
  const metadata = topLevel.find((box) => box.type === "meta");
  const mediaData = topLevel.find((box) => box.type === "mdat");
  if (
    !fileType ||
    fileType.endOffset - fileType.dataOffset < 12 ||
    !metadata ||
    metadata.endOffset - metadata.dataOffset < 4 ||
    !mediaData ||
    mediaData.endOffset === mediaData.dataOffset
  ) {
    return null;
  }

  const brands: string[] = [];
  for (let offset = fileType.dataOffset; offset + 4 <= fileType.endOffset;) {
    brands.push(String.fromCharCode(...bytes.subarray(offset, offset + 4)));
    offset += brands.length === 1 ? 8 : 4;
  }
  if (!brands.includes("avif")) return null;

  const metadataBoxes = readIsoBoxes(
    bytes,
    metadata.dataOffset + 4,
    metadata.endOffset,
  );
  const itemProperties = metadataBoxes?.find((box) => box.type === "iprp");
  if (!itemProperties) return null;
  const propertyBoxes = readIsoBoxes(
    bytes,
    itemProperties.dataOffset,
    itemProperties.endOffset,
  );
  const propertyContainer = propertyBoxes?.find((box) => box.type === "ipco");
  if (!propertyContainer) return null;
  const properties = readIsoBoxes(
    bytes,
    propertyContainer.dataOffset,
    propertyContainer.endOffset,
  );
  const spatialExtents = properties
    ?.filter(
      (box) => box.type === "ispe" && box.endOffset - box.dataOffset >= 12,
    )
    .map((box) => {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + box.dataOffset + 4,
        8,
      );
      return { width: view.getUint32(0), height: view.getUint32(4) };
    });
  if (!spatialExtents || spatialExtents.length === 0) return null;
  const dimensions = spatialExtents.reduce((largest, candidate) =>
    candidate.width * candidate.height > largest.width * largest.height
      ? candidate
      : largest,
  );
  return { mimeType: "image/avif", ...dimensions };
}

async function validateImage(
  file: File,
  bytes: Uint8Array,
): Promise<
  | { ok: true; image: VerifiedImage }
  | { ok: false; issues: AssetValidationIssue[] }
> {
  const invalid = (message: string) => ({
    ok: false as const,
    issues: [{ path: "file" as const, message }],
  });
  if (
    file.name.length === 0 ||
    file.name.length > ASSET_ORIGINAL_FILENAME_MAXIMUM_LENGTH ||
    /\p{Cc}/u.test(file.name)
  ) {
    return invalid(
      "Use a filename without control characters, up to 255 characters.",
    );
  }
  if (bytes.byteLength === 0 || bytes.byteLength > ASSET_MAXIMUM_BYTE_SIZE) {
    return invalid("Upload an image no larger than 8 MiB.");
  }

  const image =
    inspectPng(bytes) ??
    inspectJpeg(bytes) ??
    inspectWebp(bytes) ??
    inspectAvif(bytes);
  if (!image || file.type !== image.mimeType) {
    return invalid("The declared image type must match verified image bytes.");
  }
  if (
    image.width === 0 ||
    image.height === 0 ||
    image.width > ASSET_MAXIMUM_DIMENSION ||
    image.height > ASSET_MAXIMUM_DIMENSION ||
    image.width * image.height > ASSET_MAXIMUM_PIXEL_COUNT
  ) {
    return invalid(
      "Image dimensions must be at most 8192 px per side and 16777216 pixels total.",
    );
  }
  try {
    const decoded = await decodeImage(image.mimeType, bytes);
    if (decoded.width !== image.width || decoded.height !== image.height) {
      return invalid("Decoded image dimensions do not match its container.");
    }
  } catch {
    return invalid("The image pixel data could not be decoded.");
  }
  return { ok: true, image };
}

async function markFailed(
  database: D1Database,
  assetId: string,
  failureCode:
    | "D1_FINALIZE_AND_R2_CLEANUP_FAILED"
    | "D1_FINALIZE_FAILED"
    | "R2_PUT_FAILED",
): Promise<void> {
  try {
    await database
      .prepare(
        `UPDATE asset
         SET lifecycle_state = 'failed', failure_code = ?
         WHERE id = ? AND lifecycle_state = 'uploading'`,
      )
      .bind(failureCode, assetId)
      .run();
  } catch {}
}

export async function uploadAsset(
  database: D1Database,
  bucket: R2Bucket,
  file: File,
): Promise<UploadAssetResult> {
  if (file.size === 0 || file.size > ASSET_MAXIMUM_BYTE_SIZE) {
    return {
      ok: false,
      reason: "invalid",
      issues: [
        {
          path: "file",
          message: "Upload an image no larger than 8 MiB.",
        },
      ],
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const verification = await validateImage(file, bytes);
  if (!verification.ok) return { ...verification, reason: "invalid" as const };

  const id = crypto.randomUUID();
  const objectKey = `private-assets/${crypto.randomUUID()}`;
  const uploadedAt = Date.now();
  try {
    await database
      .prepare(
        `INSERT INTO asset
           (id, original_filename, mime_type, byte_size, width, height,
            uploaded_at, object_key, lifecycle_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading')`,
      )
      .bind(
        id,
        file.name,
        verification.image.mimeType,
        bytes.byteLength,
        verification.image.width,
        verification.image.height,
        uploadedAt,
        objectKey,
      )
      .run();
  } catch {
    return { ok: false, reason: "storage-failed" };
  }

  try {
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType: verification.image.mimeType },
    });
  } catch {
    await markFailed(database, id, "R2_PUT_FAILED");
    return { ok: false, reason: "storage-failed" };
  }

  try {
    const finalization = await database
      .prepare(
        `UPDATE asset
         SET lifecycle_state = 'ready'
         WHERE id = ? AND lifecycle_state = 'uploading'`,
      )
      .bind(id)
      .run();
    if (finalization.meta.changes !== 1) {
      throw new Error("Asset finalization did not update exactly one row");
    }
  } catch {
    let failureCode:
      "D1_FINALIZE_AND_R2_CLEANUP_FAILED" | "D1_FINALIZE_FAILED" =
      "D1_FINALIZE_FAILED";
    try {
      await bucket.delete(objectKey);
    } catch {
      failureCode = "D1_FINALIZE_AND_R2_CLEANUP_FAILED";
    }
    await markFailed(database, id, failureCode);
    return { ok: false, reason: "storage-failed" };
  }

  const asset = await readAsset(database, id);
  return asset ? { ok: true, asset } : { ok: false, reason: "storage-failed" };
}

export async function listAssets(database: D1Database): Promise<Asset[]> {
  const { results } = await database
    .prepare(
      `SELECT id, original_filename, mime_type, byte_size, width, height,
              uploaded_at, lifecycle_state, public_asset_id
       FROM asset
       WHERE lifecycle_state = 'ready'
       ORDER BY uploaded_at DESC, id ASC`,
    )
    .all<ReadyAssetRow>();
  return results.map(readyAssetFromRow);
}

async function readAsset(
  database: D1Database,
  assetId: string,
): Promise<Asset | null> {
  const row = await database
    .prepare(
      `SELECT id, original_filename, mime_type, byte_size, width, height,
              uploaded_at, lifecycle_state, public_asset_id
       FROM asset
       WHERE id = ? AND lifecycle_state = 'ready'
       LIMIT 1`,
    )
    .bind(assetId)
    .first<ReadyAssetRow>();
  return row ? readyAssetFromRow(row) : null;
}

export async function readPrivateAsset(
  database: D1Database,
  bucket: R2Bucket,
  assetId: string,
): Promise<{ asset: Asset; object: R2ObjectBody } | null> {
  if (!z.string().uuid().safeParse(assetId).success) return null;
  const row = await database
    .prepare(
      `SELECT id, original_filename, mime_type, byte_size, width, height,
              uploaded_at, lifecycle_state, public_asset_id, object_key
       FROM asset
       WHERE id = ? AND lifecycle_state = 'ready'
       LIMIT 1`,
    )
    .bind(assetId)
    .first<PrivateAssetRow>();
  if (!row) return null;
  const object = await bucket.get(row.object_key);
  return object ? { asset: readyAssetFromRow(row), object } : null;
}
