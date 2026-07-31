export const ASSET_MAXIMUM_BYTE_SIZE = 8 * 1024 * 1024;
export const ASSET_MAXIMUM_DIMENSION = 8_192;
export const ASSET_MAXIMUM_PIXEL_COUNT = 8_388_608;
export const ASSET_ORIGINAL_FILENAME_MAXIMUM_LENGTH = 255;

export type AssetMimeType =
  "image/avif" | "image/jpeg" | "image/png" | "image/webp";

export interface AssetReferences {
  currentDrafts: number;
  retainedPublications: number;
}

export const ASSET_CLEANUP_FAILURE_CODES = [
  "D1_DELETE_FAILED",
  "R2_DELETE_FAILED",
] as const;
export type AssetCleanupFailureCode =
  (typeof ASSET_CLEANUP_FAILURE_CODES)[number];

export interface ReadyAsset {
  id: string;
  originalFilename: string;
  mimeType: AssetMimeType;
  byteSize: number;
  width: number;
  height: number;
  uploadedAt: string;
  lifecycleState: "ready";
  publicAssetId: string | null;
}

export type ReadyAssetLibraryEntry = ReadyAsset & {
  failureCode: null;
  references: AssetReferences;
};

export type PendingDeletionAssetLibraryEntry = Omit<
  ReadyAsset,
  "lifecycleState"
> & {
  lifecycleState: "pending_deletion";
  failureCode: AssetCleanupFailureCode | null;
  references: AssetReferences;
};

export type AssetLibraryEntry =
  PendingDeletionAssetLibraryEntry | ReadyAssetLibraryEntry;

export function assetHasReferences(asset: AssetLibraryEntry): boolean {
  return (
    asset.references.currentDrafts > 0 ||
    asset.references.retainedPublications > 0
  );
}

export interface AssetValidationIssue {
  path: "file";
  message: string;
}
