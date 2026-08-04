import { z } from "zod";

import {
  ASSET_CLEANUP_FAILURE_CODES,
  ASSET_MAXIMUM_BYTE_SIZE,
  ASSET_MAXIMUM_DIMENSION,
  ASSET_MAXIMUM_PIXEL_COUNT,
  ASSET_ORIGINAL_FILENAME_MAXIMUM_LENGTH,
  assetHasReferences,
  type AssetCleanupFailureCode,
  type AssetLibraryEntry,
  type AssetMimeType,
  type AssetReferences,
  type AssetValidationIssue,
  type ReadyAsset,
  type ReadyAssetLibraryEntry,
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

const storedAssetRowSchema = z.object({
  id: z.string().uuid(),
  original_filename: z.string(),
  mime_type: z.enum(["image/avif", "image/jpeg", "image/png", "image/webp"]),
  byte_size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  uploaded_at: z.number().int(),
  public_asset_id: z.string().uuid().nullable(),
});
const readyAssetRowSchema = storedAssetRowSchema.extend({
  lifecycle_state: z.literal("ready"),
  failure_code: z.null(),
});
const libraryReferenceRowSchema = {
  object_key: z.string(),
  current_draft_references: z.number().int().nonnegative(),
  retained_publication_references: z.number().int().nonnegative(),
};
const libraryAssetRowSchema = z.discriminatedUnion("lifecycle_state", [
  readyAssetRowSchema.extend(libraryReferenceRowSchema),
  storedAssetRowSchema.extend({
    ...libraryReferenceRowSchema,
    lifecycle_state: z.literal("pending_deletion"),
    failure_code: z.enum(ASSET_CLEANUP_FAILURE_CODES).nullable(),
  }),
]);

type ReadyAssetRow = z.infer<typeof readyAssetRowSchema>;
type LibraryAssetRow = z.infer<typeof libraryAssetRowSchema>;

interface PrivateAssetRow extends ReadyAssetRow {
  object_key: string;
}

const assetLibrarySelection = `
  SELECT asset.id, asset.original_filename, asset.mime_type, asset.byte_size,
         asset.width, asset.height, asset.uploaded_at, asset.lifecycle_state,
         asset.failure_code, asset.public_asset_id, asset.object_key,
         (
           SELECT COUNT(*)
           FROM article_draft_asset_reference
           WHERE asset_id = asset.id
         ) AS current_draft_references,
         (
           SELECT COUNT(*)
           FROM publication_asset_reference
           WHERE asset_id = asset.id
         ) AS retained_publication_references
  FROM asset
`;
const assetHasNoReferencesCondition = `
  NOT EXISTS (
    SELECT 1 FROM article_draft_asset_reference
    WHERE asset_id = asset.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM publication_asset_reference
    WHERE asset_id = asset.id
  )
`;

export interface PublicationAssetResolution {
  assetId: string;
  publicAssetId: string;
  publicUrl: string;
  width: number;
  height: number;
  delivery: "public";
}

interface UnsafePublicationAssetResolution {
  assetId: string;
  rejection: "unsafe";
}

type AssetRenderingVerification =
  | { ok: true; row: PrivateAssetRow }
  | { ok: false; reason: "unavailable" | "unsafe" };

export type UploadAssetResult =
  | { ok: true; asset: ReadyAssetLibraryEntry }
  | { ok: false; reason: "invalid"; issues: AssetValidationIssue[] }
  | { ok: false; reason: "storage-failed" };

function assetMetadataFromRow(row: z.infer<typeof storedAssetRowSchema>) {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    publicAssetId: row.public_asset_id,
  };
}

function readyAssetFromRow(row: ReadyAssetRow): ReadyAsset {
  const value = readyAssetRowSchema.parse(row);
  return { ...assetMetadataFromRow(value), lifecycleState: "ready" };
}

function readyAssetLibraryEntry(asset: ReadyAsset): ReadyAssetLibraryEntry {
  return {
    ...asset,
    failureCode: null,
    references: { currentDrafts: 0, retainedPublications: 0 },
  };
}

function libraryAssetFromRow(row: LibraryAssetRow): AssetLibraryEntry {
  const value = libraryAssetRowSchema.parse(row);
  const common = {
    ...assetMetadataFromRow(value),
    references: {
      currentDrafts: value.current_draft_references,
      retainedPublications: value.retained_publication_references,
    },
  };
  return value.lifecycle_state === "ready"
    ? {
        ...common,
        lifecycleState: "ready",
        failureCode: null,
      }
    : {
        ...common,
        lifecycleState: "pending_deletion",
        failureCode: value.failure_code,
      };
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
      "Image dimensions must be at most 8192 px per side and 8388608 pixels total.",
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
  return asset
    ? { ok: true, asset: readyAssetLibraryEntry(asset) }
    : { ok: false, reason: "storage-failed" };
}

export async function listAssets(
  database: D1Database,
): Promise<AssetLibraryEntry[]> {
  const { results } = await database
    .prepare(
      `${assetLibrarySelection}
       WHERE lifecycle_state IN ('ready', 'pending_deletion')
       ORDER BY uploaded_at DESC, id ASC`,
    )
    .all<LibraryAssetRow>();
  return results.map(libraryAssetFromRow);
}

export type CleanupAssetResult =
  | { ok: true }
  | {
      ok: false;
      reason: "referenced";
      references: AssetReferences;
    }
  | { ok: false; reason: "storage-failed"; asset: AssetLibraryEntry };

async function recordCleanupFailure(
  database: D1Database,
  assetId: string,
  failureCode: AssetCleanupFailureCode,
  fallback: AssetLibraryEntry,
): Promise<AssetLibraryEntry> {
  try {
    await database
      .prepare(
        `UPDATE asset
         SET failure_code = ?
         WHERE id = ? AND lifecycle_state = 'pending_deletion'`,
      )
      .bind(failureCode, assetId)
      .run();
    const row = await database
      .prepare(
        `${assetLibrarySelection}
         WHERE id = ? AND lifecycle_state = 'pending_deletion'
         LIMIT 1`,
      )
      .bind(assetId)
      .first<LibraryAssetRow>();
    if (row) return libraryAssetFromRow(row);
  } catch {}
  return fallback;
}

export async function cleanupAsset(
  database: D1Database,
  bucket: R2Bucket,
  assetId: string,
): Promise<CleanupAssetResult> {
  if (!z.string().uuid().safeParse(assetId).success) return { ok: true };
  const statements = [
    database
      .prepare(
        `UPDATE asset
         SET lifecycle_state = 'pending_deletion', failure_code = NULL
         WHERE id = ? AND lifecycle_state = 'ready'
           AND ${assetHasNoReferencesCondition}
         RETURNING object_key`,
      )
      .bind(assetId),
    database
      .prepare(
        `${assetLibrarySelection}
         WHERE id = ? AND lifecycle_state IN ('ready', 'pending_deletion')
         LIMIT 1`,
      )
      .bind(assetId),
  ];
  const batch = await database.batch(statements);
  const claimed = batch[0]?.results[0] as { object_key: string } | undefined;
  const row = batch[1]?.results[0] as LibraryAssetRow | undefined;
  if (!row) return { ok: true };

  const asset = libraryAssetFromRow(row);
  if (assetHasReferences(asset)) {
    return {
      ok: false,
      reason: "referenced",
      references: asset.references,
    };
  }
  if (asset.lifecycleState === "ready" && !claimed) {
    return { ok: false, reason: "storage-failed", asset };
  }

  try {
    await bucket.delete(row.object_key);
  } catch {
    return {
      ok: false,
      reason: "storage-failed",
      asset: await recordCleanupFailure(
        database,
        assetId,
        "R2_DELETE_FAILED",
        asset,
      ),
    };
  }

  try {
    const deletion = await database
      .prepare(
        `DELETE FROM asset
         WHERE id = ? AND lifecycle_state = 'pending_deletion'
           AND ${assetHasNoReferencesCondition}`,
      )
      .bind(assetId)
      .run();
    if (deletion.meta.changes === 1) return { ok: true };
  } catch {
    return {
      ok: false,
      reason: "storage-failed",
      asset: await recordCleanupFailure(
        database,
        assetId,
        "D1_DELETE_FAILED",
        asset,
      ),
    };
  }

  const remaining = await database
    .prepare(
      `${assetLibrarySelection}
       WHERE id = ? AND lifecycle_state IN ('ready', 'pending_deletion')
       LIMIT 1`,
    )
    .bind(assetId)
    .first<LibraryAssetRow>();
  if (!remaining) return { ok: true };

  const remainingAsset = libraryAssetFromRow(remaining);
  if (assetHasReferences(remainingAsset)) {
    return {
      ok: false,
      reason: "referenced",
      references: remainingAsset.references,
    };
  }
  return {
    ok: false,
    reason: "storage-failed",
    asset: await recordCleanupFailure(
      database,
      assetId,
      "D1_DELETE_FAILED",
      remainingAsset,
    ),
  };
}

async function readAsset(
  database: D1Database,
  assetId: string,
): Promise<ReadyAsset | null> {
  const row = await database
    .prepare(
      `SELECT id, original_filename, mime_type, byte_size, width, height,
              uploaded_at, lifecycle_state, failure_code, public_asset_id
       FROM asset
       WHERE id = ? AND lifecycle_state = 'ready'
       LIMIT 1`,
    )
    .bind(assetId)
    .first<ReadyAssetRow>();
  return row ? readyAssetFromRow(row) : null;
}

async function readReadyPrivateAssetRow(
  database: D1Database,
  assetId: string,
): Promise<PrivateAssetRow | null> {
  if (!z.string().uuid().safeParse(assetId).success) return null;
  return database
    .prepare(
      `SELECT id, original_filename, mime_type, byte_size, width, height,
              uploaded_at, lifecycle_state, failure_code, public_asset_id,
              object_key
       FROM asset
       WHERE id = ? AND lifecycle_state = 'ready'
       LIMIT 1`,
    )
    .bind(assetId)
    .first<PrivateAssetRow>();
}

export async function readPrivateAsset(
  database: D1Database,
  bucket: R2Bucket,
  assetId: string,
): Promise<{ asset: ReadyAsset; object: R2ObjectBody } | null> {
  const row = await readReadyPrivateAssetRow(database, assetId);
  if (!row) return null;
  const object = await bucket.get(row.object_key);
  return object ? { asset: readyAssetFromRow(row), object } : null;
}

export async function resolvePrivateAssetForRendering(
  database: D1Database,
  bucket: R2Bucket,
  applicationOrigin: string,
  assetId: string,
) {
  const verified = await verifyAssetForRendering(database, bucket, assetId);
  if (!verified.ok) {
    return verified.reason === "unsafe"
      ? ({ assetId, rejection: "unsafe" } as const)
      : null;
  }

  return {
    assetId: verified.row.id,
    publicUrl: new URL(`/media/private/${verified.row.id}`, applicationOrigin)
      .href,
    width: verified.row.width,
    height: verified.row.height,
    delivery: "private" as const,
  };
}

async function derivedPublicAssetId(assetId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`briefly-public-asset:${assetId}`),
    ),
  );
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.subarray(0, 16)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function objectMatchesAsset(row: PrivateAssetRow, object: R2Object): boolean {
  return (
    object.size === row.byte_size &&
    object.httpMetadata?.contentType === row.mime_type
  );
}

function assetFactsAreSafe(row: PrivateAssetRow): boolean {
  try {
    readyAssetFromRow(row);
  } catch {
    return false;
  }
  return (
    row.byte_size <= ASSET_MAXIMUM_BYTE_SIZE &&
    row.width <= ASSET_MAXIMUM_DIMENSION &&
    row.height <= ASSET_MAXIMUM_DIMENSION &&
    row.width * row.height <= ASSET_MAXIMUM_PIXEL_COUNT
  );
}

async function verifyAssetForRendering(
  database: D1Database,
  bucket: R2Bucket,
  assetId: string,
): Promise<AssetRenderingVerification> {
  const row = await readReadyPrivateAssetRow(database, assetId);
  if (!row) return { ok: false, reason: "unavailable" };
  const object = await bucket.head(row.object_key);
  if (!object || !objectMatchesAsset(row, object)) {
    return { ok: false, reason: "unavailable" };
  }
  return assetFactsAreSafe(row)
    ? { ok: true, row }
    : { ok: false, reason: "unsafe" };
}

export async function resolveAssetForPublication(
  database: D1Database,
  bucket: R2Bucket,
  applicationOrigin: string,
  assetId: string,
): Promise<
  PublicationAssetResolution | UnsafePublicationAssetResolution | null
> {
  const verified = await verifyAssetForRendering(database, bucket, assetId);
  if (!verified.ok) {
    return verified.reason === "unsafe"
      ? { assetId, rejection: "unsafe" }
      : null;
  }
  const { row } = verified;

  const publicAssetId =
    row.public_asset_id ?? (await derivedPublicAssetId(row.id));
  return {
    assetId: row.id,
    publicAssetId,
    publicUrl: new URL(`/media/${publicAssetId}`, applicationOrigin).href,
    width: row.width,
    height: row.height,
    delivery: "public",
  };
}

async function readPublicAssetRow(
  database: D1Database,
  publicAssetId: string,
): Promise<PrivateAssetRow | null> {
  if (!z.string().uuid().safeParse(publicAssetId).success) return null;
  return database
    .prepare(
      `SELECT id, original_filename, mime_type, byte_size, width, height,
              uploaded_at, lifecycle_state, failure_code, public_asset_id,
              object_key
       FROM asset
       WHERE public_asset_id = ? AND lifecycle_state = 'ready'
       LIMIT 1`,
    )
    .bind(publicAssetId)
    .first<PrivateAssetRow>();
}

async function readPublicAssetObject<ObjectType extends R2Object>(
  database: D1Database,
  publicAssetId: string,
  readObject: (objectKey: string) => Promise<ObjectType | null>,
): Promise<{ asset: ReadyAsset; object: ObjectType } | null> {
  const row = await readPublicAssetRow(database, publicAssetId);
  if (!row) return null;
  const object = await readObject(row.object_key);
  if (!object || !objectMatchesAsset(row, object)) return null;
  return { asset: readyAssetFromRow(row), object };
}

export function readPublicAsset(
  database: D1Database,
  bucket: R2Bucket,
  publicAssetId: string,
): Promise<{ asset: ReadyAsset; object: R2ObjectBody } | null> {
  return readPublicAssetObject(database, publicAssetId, (objectKey) =>
    bucket.get(objectKey),
  );
}

export async function headPublicAsset(
  database: D1Database,
  bucket: R2Bucket,
  publicAssetId: string,
): Promise<{ asset: ReadyAsset; object: R2Object } | null> {
  return readPublicAssetObject(database, publicAssetId, (objectKey) =>
    bucket.head(objectKey),
  );
}
