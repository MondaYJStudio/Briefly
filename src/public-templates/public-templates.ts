export const PUBLIC_TEMPLATE_R2_PREFIX = "public-templates";
export const PUBLIC_TEMPLATE_MAXIMUM_ZIP_BYTE_SIZE = 10 * 1024 * 1024;
export const PUBLIC_TEMPLATE_MAXIMUM_FILE_COUNT = 200;
export const PUBLIC_TEMPLATE_MAXIMUM_FILE_BYTE_SIZE = 2 * 1024 * 1024;
export const PUBLIC_TEMPLATE_MANIFEST_FILENAME = "manifest.json";
export const PUBLIC_TEMPLATE_INDEX_FILENAME = "index.html";

export const PUBLIC_TEMPLATE_ALLOWED_EXTENSIONS = [
  "css",
  "gif",
  "html",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "png",
  "svg",
  "txt",
  "webmanifest",
  "webp",
  "woff",
  "woff2",
] as const;

export type PublicTemplateAllowedExtension =
  (typeof PUBLIC_TEMPLATE_ALLOWED_EXTENSIONS)[number];

export interface InstalledPublicTemplate {
  installationId: string;
  manifestId: string;
  version: string;
  name: string;
  active: boolean;
  installedAt: string;
}

export interface PublicTemplateValidationIssue {
  path: string;
  message: string;
}
