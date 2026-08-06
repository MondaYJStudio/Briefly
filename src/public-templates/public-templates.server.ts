import { unzipSync } from "fflate";
import { z } from "zod";

import {
  PUBLIC_TEMPLATE_ALLOWED_EXTENSIONS,
  PUBLIC_TEMPLATE_INDEX_FILENAME,
  PUBLIC_TEMPLATE_MANIFEST_FILENAME,
  PUBLIC_TEMPLATE_MAXIMUM_FILE_BYTE_SIZE,
  PUBLIC_TEMPLATE_MAXIMUM_FILE_COUNT,
  PUBLIC_TEMPLATE_MAXIMUM_ZIP_BYTE_SIZE,
  PUBLIC_TEMPLATE_R2_PREFIX,
  type InstalledPublicTemplate,
  type PublicTemplateValidationIssue,
  isReservedBrieflyPublicPath,
} from "./public-templates";

export { isReservedBrieflyPublicPath };
const templateManifestSchema = z.object({
  id: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(120),
});

type TemplateManifest = z.infer<typeof templateManifestSchema>;

interface ValidatedPackageFile {
  relativePath: string;
  bytes: Uint8Array;
  contentType: string;
}

interface ValidatedPackage {
  manifest: TemplateManifest;
  manifestJson: string;
  files: ValidatedPackageFile[];
}

export type InstallPublicTemplateResult =
  | { ok: true; template: InstalledPublicTemplate }
  | { ok: false; reason: "invalid"; issues: PublicTemplateValidationIssue[] }
  | { ok: false; reason: "storage-failed" };

const allowedExtensionSet = new Set<string>(PUBLIC_TEMPLATE_ALLOWED_EXTENSIONS);

const contentTypesByExtension: Record<string, string> = {
  css: "text/css; charset=utf-8",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
};

function issue(
  path: string,
  message: string,
): PublicTemplateValidationIssue {
  return { path, message };
}

function objectKeyFor(installationId: string, relativePath: string): string {
  return `${PUBLIC_TEMPLATE_R2_PREFIX}/${installationId}/${relativePath}`;
}

function normalizePackagePath(
  rawPath: string,
):
  | { ok: true; relativePath: string }
  | { ok: false; issue: PublicTemplateValidationIssue } {
  const trimmed = rawPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!trimmed || trimmed.endsWith("/")) {
    return {
      ok: false,
      issue: issue("file", "Public Template packages cannot include empty paths."),
    };
  }
  const segments = trimmed.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" || segment === "." || segment === ".." || segment.includes("\0"),
    )
  ) {
    return {
      ok: false,
      issue: issue(
        "file",
        "Public Template packages cannot include path traversal or empty path segments.",
      ),
    };
  }
  return { ok: true, relativePath: segments.join("/") };
}

function extensionFor(relativePath: string): string | null {
  const base = relativePath.split("/").at(-1) ?? relativePath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

function validatePackage(bytes: Uint8Array):
  | { ok: true; package: ValidatedPackage }
  | { ok: false; issues: PublicTemplateValidationIssue[] } {
  if (bytes.byteLength === 0) {
    return {
      ok: false,
      issues: [issue("file", "Upload a Public Template zip.")],
    };
  }
  if (bytes.byteLength > PUBLIC_TEMPLATE_MAXIMUM_ZIP_BYTE_SIZE) {
    return {
      ok: false,
      issues: [
        issue(
          "file",
          `Upload a Public Template zip no larger than ${PUBLIC_TEMPLATE_MAXIMUM_ZIP_BYTE_SIZE / (1024 * 1024)} MiB.`,
        ),
      ],
    };
  }

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    return {
      ok: false,
      issues: [issue("file", "Upload a valid Public Template zip.")],
    };
  }

  const fileEntries = Object.entries(unzipped).filter(
    ([path, content]) => !path.endsWith("/") && content.byteLength >= 0,
  );
  if (fileEntries.length === 0) {
    return {
      ok: false,
      issues: [issue("file", "Upload a Public Template zip that contains files.")],
    };
  }
  if (fileEntries.length > PUBLIC_TEMPLATE_MAXIMUM_FILE_COUNT) {
    return {
      ok: false,
      issues: [
        issue(
          "file",
          `Public Template packages may include at most ${PUBLIC_TEMPLATE_MAXIMUM_FILE_COUNT} files.`,
        ),
      ],
    };
  }

  const files: ValidatedPackageFile[] = [];
  let hasIndex = false;
  let manifestBytes: Uint8Array | undefined;

  for (const [rawPath, content] of fileEntries) {
    const normalized = normalizePackagePath(rawPath);
    if (!normalized.ok) return { ok: false, issues: [normalized.issue] };

    if (content.byteLength > PUBLIC_TEMPLATE_MAXIMUM_FILE_BYTE_SIZE) {
      return {
        ok: false,
        issues: [
          issue(
            normalized.relativePath,
            `Each Public Template file must be at most ${PUBLIC_TEMPLATE_MAXIMUM_FILE_BYTE_SIZE / (1024 * 1024)} MiB.`,
          ),
        ],
      };
    }

    const extension = extensionFor(normalized.relativePath);
    if (!extension || !allowedExtensionSet.has(extension)) {
      return {
        ok: false,
        issues: [
          issue(
            normalized.relativePath,
            "Public Template packages may only include allowlisted static file types.",
          ),
        ],
      };
    }

    if (normalized.relativePath === PUBLIC_TEMPLATE_INDEX_FILENAME) {
      hasIndex = true;
    }
    if (normalized.relativePath === PUBLIC_TEMPLATE_MANIFEST_FILENAME) {
      manifestBytes = content;
    }

    files.push({
      relativePath: normalized.relativePath,
      bytes: content,
      contentType:
        contentTypesByExtension[extension] ?? "application/octet-stream",
    });
  }

  if (!manifestBytes) {
    return {
      ok: false,
      issues: [
        issue(
          PUBLIC_TEMPLATE_MANIFEST_FILENAME,
          "Public Template packages must include a root manifest.json.",
        ),
      ],
    };
  }
  if (!hasIndex) {
    return {
      ok: false,
      issues: [
        issue(
          PUBLIC_TEMPLATE_INDEX_FILENAME,
          "Public Template packages must include a root index.html.",
        ),
      ],
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return {
      ok: false,
      issues: [
        issue(
          PUBLIC_TEMPLATE_MANIFEST_FILENAME,
          "manifest.json must be valid JSON.",
        ),
      ],
    };
  }

  const parsedManifest = templateManifestSchema.safeParse(parsedJson);
  if (!parsedManifest.success) {
    return {
      ok: false,
      issues: [
        issue(
          PUBLIC_TEMPLATE_MANIFEST_FILENAME,
          "manifest.json must include id, version, and name.",
        ),
      ],
    };
  }

  return {
    ok: true,
    package: {
      manifest: parsedManifest.data,
      manifestJson: JSON.stringify(parsedJson),
      files,
    },
  };
}

async function deleteInstallationPrefix(
  bucket: R2Bucket,
  installationId: string,
): Promise<void> {
  const prefix = `${PUBLIC_TEMPLATE_R2_PREFIX}/${installationId}/`;
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await Promise.all(
        listed.objects.map((object) => bucket.delete(object.key)),
      );
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function writeInstallationFiles(
  bucket: R2Bucket,
  installationId: string,
  files: ValidatedPackageFile[],
): Promise<void> {
  for (const file of files) {
    await bucket.put(objectKeyFor(installationId, file.relativePath), file.bytes, {
      httpMetadata: { contentType: file.contentType },
    });
  }
}

function templateFromRow(
  row: {
    installation_id: string;
    manifest_id: string;
    version: string;
    name: string;
    installed_at: number;
  },
  activeInstallationId: string | null,
): InstalledPublicTemplate {
  return {
    installationId: row.installation_id,
    manifestId: row.manifest_id,
    version: row.version,
    name: row.name,
    active: row.installation_id === activeInstallationId,
    installedAt: new Date(row.installed_at).toISOString(),
  };
}

async function readActiveInstallationId(
  database: D1Database,
): Promise<string | null> {
  const row = await database
    .prepare(
      "SELECT active_installation_id FROM site_public_presentation WHERE id = 1",
    )
    .first<{ active_installation_id: string | null }>();
  return row?.active_installation_id ?? null;
}

export async function listInstalledPublicTemplates(
  database: D1Database,
): Promise<InstalledPublicTemplate[]> {
  const activeInstallationId = await readActiveInstallationId(database);
  const { results } = await database
    .prepare(
      `SELECT installation_id, manifest_id, version, name, installed_at
       FROM installed_public_template
       ORDER BY installed_at DESC, installation_id ASC`,
    )
    .all<{
      installation_id: string;
      manifest_id: string;
      version: string;
      name: string;
      installed_at: number;
    }>();
  return results.map((row) => templateFromRow(row, activeInstallationId));
}

export type ActivatePublicTemplateResult =
  | { ok: true; template: InstalledPublicTemplate }
  | { ok: false; reason: "not-found" };

export type DeactivatePublicTemplateResult = { active: false };

export async function activateInstalledPublicTemplate(
  database: D1Database,
  installationId: string,
): Promise<ActivatePublicTemplateResult> {
  const row = await database
    .prepare(
      `SELECT installation_id, manifest_id, version, name, installed_at
       FROM installed_public_template
       WHERE installation_id = ?`,
    )
    .bind(installationId)
    .first<{
      installation_id: string;
      manifest_id: string;
      version: string;
      name: string;
      installed_at: number;
    }>();
  if (!row) return { ok: false, reason: "not-found" };

  await database
    .prepare(
      `UPDATE site_public_presentation
       SET active_installation_id = ?
       WHERE id = 1`,
    )
    .bind(installationId)
    .run();

  return {
    ok: true,
    template: templateFromRow(row, installationId),
  };
}

export async function deactivateActivePublicTemplate(
  database: D1Database,
): Promise<DeactivatePublicTemplateResult> {
  await database
    .prepare(
      `UPDATE site_public_presentation
       SET active_installation_id = NULL
       WHERE id = 1`,
    )
    .run();
  return { active: false };
}

function relativePathFromUrlPathname(pathname: string): string | null {
  if (pathname === "/" || pathname === "") return PUBLIC_TEMPLATE_INDEX_FILENAME;
  const trimmed = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return PUBLIC_TEMPLATE_INDEX_FILENAME;
  const normalized = normalizePackagePath(trimmed);
  if (!normalized.ok) return null;
  return normalized.relativePath;
}

export type ServeActivePublicTemplateResult =
  | { kind: "pass-through" }
  | { kind: "method-not-allowed" }
  | { kind: "unavailable" }
  | { kind: "response"; response: Response };

export async function serveActivePublicTemplate(
  database: D1Database,
  bucket: R2Bucket,
  request: Request,
): Promise<ServeActivePublicTemplateResult> {
  const activeInstallationId = await readActiveInstallationId(database);
  if (!activeInstallationId) return { kind: "pass-through" };

  if (request.method !== "GET" && request.method !== "HEAD") {
    return { kind: "method-not-allowed" };
  }

  const url = new URL(request.url);
  const relativePath = relativePathFromUrlPathname(url.pathname);
  let object: R2ObjectBody | null = null;
  let contentType = "application/octet-stream";

  if (relativePath !== null) {
    object = await bucket.get(objectKeyFor(activeInstallationId, relativePath));
    contentType =
      object?.httpMetadata?.contentType ??
      contentTypesByExtension[extensionFor(relativePath) ?? ""] ??
      "application/octet-stream";
  }

  if (!object) {
    object = await bucket.get(
      objectKeyFor(activeInstallationId, PUBLIC_TEMPLATE_INDEX_FILENAME),
    );
    contentType =
      object?.httpMetadata?.contentType ?? "text/html; charset=utf-8";
    if (!object) return { kind: "unavailable" };
  }

  const headers = new Headers({
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  if (typeof object.size === "number") {
    headers.set("content-length", String(object.size));
  }

  const body =
    request.method === "HEAD" ? null : await object.arrayBuffer();

  return {
    kind: "response",
    response: new Response(body, {
      status: 200,
      headers,
    }),
  };
}

export async function installPublicTemplateFromZip(
  database: D1Database,
  bucket: R2Bucket,
  file: File,
): Promise<InstallPublicTemplateResult> {
  if (file.size === 0 || file.size > PUBLIC_TEMPLATE_MAXIMUM_ZIP_BYTE_SIZE) {
    return {
      ok: false,
      reason: "invalid",
      issues: [
        issue(
          "file",
          file.size === 0
            ? "Upload a Public Template zip."
            : `Upload a Public Template zip no larger than ${PUBLIC_TEMPLATE_MAXIMUM_ZIP_BYTE_SIZE / (1024 * 1024)} MiB.`,
        ),
      ],
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validated = validatePackage(bytes);
  if (!validated.ok) {
    return { ok: false, reason: "invalid", issues: validated.issues };
  }

  const installationId = crypto.randomUUID();
  const installedAt = Date.now();
  const { manifest, manifestJson, files } = validated.package;

  const existing = await database
    .prepare(
      `SELECT installation_id
       FROM installed_public_template
       WHERE manifest_id = ?`,
    )
    .bind(manifest.id)
    .first<{ installation_id: string }>();

  try {
    await writeInstallationFiles(bucket, installationId, files);
  } catch {
    await deleteInstallationPrefix(bucket, installationId).catch(() => {});
    return { ok: false, reason: "storage-failed" };
  }

  const previousInstallationId = existing?.installation_id;
  try {
    if (existing) {
      const activeInstallationId = await readActiveInstallationId(database);
      const wasActive = activeInstallationId === existing.installation_id;
      const statements = [
        database
          .prepare(
            `UPDATE site_public_presentation
             SET active_installation_id = NULL
             WHERE active_installation_id = ?`,
          )
          .bind(existing.installation_id),
        database
          .prepare(
            `DELETE FROM installed_public_template WHERE installation_id = ?`,
          )
          .bind(existing.installation_id),
        database
          .prepare(
            `INSERT INTO installed_public_template
               (installation_id, manifest_id, version, name, installed_at, manifest_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            installationId,
            manifest.id,
            manifest.version,
            manifest.name,
            installedAt,
            manifestJson,
          ),
      ];
      if (wasActive) {
        statements.push(
          database
            .prepare(
              `UPDATE site_public_presentation
               SET active_installation_id = ?
               WHERE id = 1`,
            )
            .bind(installationId),
        );
      }
      await database.batch(statements);
    } else {
      await database
        .prepare(
          `INSERT INTO installed_public_template
             (installation_id, manifest_id, version, name, installed_at, manifest_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          installationId,
          manifest.id,
          manifest.version,
          manifest.name,
          installedAt,
          manifestJson,
        )
        .run();
    }
  } catch {
    await deleteInstallationPrefix(bucket, installationId).catch(() => {});
    return { ok: false, reason: "storage-failed" };
  }

  // D1 already points at the new tree; old-prefix cleanup must not undo a
  // successful install by deleting the new objects.
  if (previousInstallationId) {
    await deleteInstallationPrefix(bucket, previousInstallationId).catch(
      () => {},
    );
  }

  const activeInstallationId = await readActiveInstallationId(database);
  return {
    ok: true,
    template: {
      installationId,
      manifestId: manifest.id,
      version: manifest.version,
      name: manifest.name,
      active: installationId === activeInstallationId,
      installedAt: new Date(installedAt).toISOString(),
    },
  };
}
