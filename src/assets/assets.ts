export const ASSET_MAXIMUM_BYTE_SIZE = 8 * 1024 * 1024;
export const ASSET_MAXIMUM_DIMENSION = 8_192;
export const ASSET_MAXIMUM_PIXEL_COUNT = 8_388_608;
export const ASSET_ORIGINAL_FILENAME_MAXIMUM_LENGTH = 255;

export type AssetMimeType =
  "image/avif" | "image/jpeg" | "image/png" | "image/webp";

export interface Asset {
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

export interface AssetValidationIssue {
  path: "file";
  message: string;
}
