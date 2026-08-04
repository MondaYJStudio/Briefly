import { z } from "zod";

import {
  resolveAssetForPublication,
  resolvePrivateAssetForRendering,
  type PublicationAssetResolution,
} from "../assets/assets.server";
import {
  BYLINE_NAME_MAXIMUM_LENGTH,
  BYLINE_URL_MAXIMUM_LENGTH,
  LANGUAGE_TAG_MAXIMUM_LENGTH,
  type Byline,
} from "../site-settings/site-settings";
import {
  ARTICLE_ASSET_ALT_MAXIMUM_LENGTH,
  ARTICLE_SUMMARY_MAXIMUM_LENGTH,
  ARTICLE_TAG_MAXIMUM_LENGTH,
  ARTICLE_TAGS_MAXIMUM_COUNT,
  ARTICLE_TITLE_MAXIMUM_LENGTH,
  type ArticleCoverUsage,
  type PublicArticleCover,
} from "./articles";
import { articleSlugKey, articleSlugSchema } from "./article-slug";
import { confirmCurrentPublicArticle } from "./public-article-projection.server";
import {
  renderPublication,
  type PublicationRendererDependencies,
  type PublicationRendererDiagnostic,
  type PublicationRendererDiagnosticCode,
} from "./publication-renderer.server";
import {
  PUBLICATION_WORKFLOW_ERROR_CODES,
  type PreviewSavedDraftCommand,
  type PublicationIssue,
  type PublicationIssueCode,
  type PublicationPreview,
  type PublicationReceipt,
  type PublicationWorkflowErrorCode,
  type PublicationWorkflowResult,
  type PublishSavedDraftCommand,
} from "./publication-workflow";

interface SavedDraftRow {
  id: unknown;
  current_publication_id: unknown;
  version: unknown;
  title: unknown;
  slug: unknown;
  summary: unknown;
  tags: unknown;
  byline: unknown;
  language: unknown;
  cover: unknown;
  document: unknown;
}

interface SavedDraft {
  articleId: string;
  currentPublicationId: string | null;
  version: number;
  title: string;
  slug: string | null;
  summary: string | null;
  tags: string[];
  byline: Byline | null;
  language: string | null;
  cover: ArticleCoverUsage | null;
  document: { documentSchemaVersion: number; doc: unknown };
}

interface ResolvedMetadata {
  byline: Byline;
  language: string;
}

interface PreparedPublication {
  draft: SavedDraft;
  metadata: ResolvedMetadata;
  rendered: Extract<
    Awaited<ReturnType<typeof renderPublication>>,
    { ok: true }
  >["value"];
  resolvedAssets: Map<string, PublicationAssetResolution>;
}

type PreparationResult =
  | { ok: true; prepared: PreparedPublication }
  | { ok: false; reason: "invalid"; issues: PublicationIssue[] }
  | { ok: false; reason: "conflict" | "not-found" };

type IssuePhase =
  "persisted" | "metadata" | "document" | "assets" | "rendering";

interface PhasedIssue extends PublicationIssue {
  phase: IssuePhase;
}

const issuePhaseOrder: Record<IssuePhase, number> = {
  persisted: 0,
  metadata: 1,
  document: 2,
  assets: 3,
  rendering: 4,
};

const bylineSchema = z
  .object({
    name: z.string().trim().min(1).max(BYLINE_NAME_MAXIMUM_LENGTH),
    url: z
      .string()
      .max(BYLINE_URL_MAXIMUM_LENGTH)
      .url()
      .refine((value) => ["http:", "https:"].includes(new URL(value).protocol))
      .transform((value) => new URL(value).toString())
      .nullable(),
  })
  .strict();

const languageSchema = z
  .string()
  .max(LANGUAGE_TAG_MAXIMUM_LENGTH)
  .superRefine((value, context) => {
    try {
      if (Intl.getCanonicalLocales(value).length !== 1) throw new Error();
    } catch {
      context.addIssue({ code: "custom", message: "Invalid language" });
    }
  })
  .transform((value) => Intl.getCanonicalLocales(value)[0]);

const coverSchema = z
  .object({
    assetId: z.string().uuid(),
    alt: z.string().trim().min(1).max(ARTICLE_ASSET_ALT_MAXIMUM_LENGTH),
  })
  .strict();

const tagSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(ARTICLE_TAG_MAXIMUM_LENGTH))
  .transform((value) => value.toLocaleLowerCase("und"));

const tagsSchema = z
  .array(tagSchema)
  .max(ARTICLE_TAGS_MAXIMUM_COUNT)
  .transform((tags) => [...new Set(tags)]);

const documentEnvelopeSchema = z
  .object({
    documentSchemaVersion: z.number(),
    doc: z.unknown(),
  })
  .passthrough();

class PublicationAssetAdapterError extends Error {
  constructor(cause: unknown) {
    super("Publication Asset adapter failed", { cause });
    this.name = "PublicationAssetAdapterError";
  }
}

export class PublicationWorkflowError extends Error {
  readonly code: PublicationWorkflowErrorCode;

  constructor(code: PublicationWorkflowErrorCode, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "PublicationWorkflowError";
    this.code = code;
  }
}

export function isPublicationWorkflowError(
  value: unknown,
): value is PublicationWorkflowError {
  return (
    value instanceof PublicationWorkflowError &&
    PUBLICATION_WORKFLOW_ERROR_CODES.includes(value.code)
  );
}

function issue(
  phase: IssuePhase,
  code: PublicationIssueCode,
  path: string,
  message: string,
): PhasedIssue {
  return { phase, code, path, message };
}

function canonicalIssues(issues: PhasedIssue[]): PublicationIssue[] {
  const seen = new Set<string>();
  return [...issues]
    .sort(
      (left, right) =>
        issuePhaseOrder[left.phase] - issuePhaseOrder[right.phase] ||
        left.path.localeCompare(right.path) ||
        left.code.localeCompare(right.code),
    )
    .filter(({ code, path }) => {
      const key = `${code}:${path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ phase: _phase, ...publicationIssue }) => publicationIssue);
}

function invalidPersistedField(field: string): PhasedIssue {
  return issue(
    "persisted",
    "INVALID",
    `draft.${field}`,
    `The saved Draft ${field} is invalid.`,
  );
}

function parseJson(
  value: unknown,
): { ok: true; value: unknown } | { ok: false } {
  if (typeof value !== "string") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

function parseCanonical<Value>(
  schema: z.ZodType<Value>,
  value: unknown,
): Value | undefined {
  const parsed = schema.safeParse(value);
  if (
    !parsed.success ||
    JSON.stringify(parsed.data) !== JSON.stringify(value)
  ) {
    return undefined;
  }
  return parsed.data;
}

function decodeSavedDraft(
  row: SavedDraftRow,
): { ok: true; draft: SavedDraft } | { ok: false; issues: PhasedIssue[] } {
  const issues: PhasedIssue[] = [];
  const articleId = z.string().uuid().safeParse(row.id);
  const currentPublicationId = z
    .string()
    .uuid()
    .nullable()
    .safeParse(row.current_publication_id);
  if (!articleId.success || !currentPublicationId.success) {
    throw new Error("Persisted Article identity is invalid");
  }

  const version = z.number().int().positive().safeParse(row.version);
  if (!version.success) issues.push(invalidPersistedField("version"));

  const title = parseCanonical(
    z.string().trim().max(ARTICLE_TITLE_MAXIMUM_LENGTH),
    row.title,
  );
  if (title === undefined) issues.push(invalidPersistedField("title"));

  const slug =
    row.slug === null ? null : parseCanonical(articleSlugSchema, row.slug);
  if (slug === undefined) issues.push(invalidPersistedField("slug"));

  const summary = parseCanonical(
    z.string().max(ARTICLE_SUMMARY_MAXIMUM_LENGTH).nullable(),
    row.summary,
  );
  if (summary === undefined) issues.push(invalidPersistedField("summary"));

  const rawTags = parseJson(row.tags);
  const tags = rawTags.ok
    ? parseCanonical(tagsSchema, rawTags.value)
    : undefined;
  if (tags === undefined) issues.push(invalidPersistedField("tags"));

  const rawByline =
    row.byline === null
      ? { ok: true as const, value: null }
      : parseJson(row.byline);
  const byline = rawByline.ok
    ? parseCanonical(bylineSchema.nullable(), rawByline.value)
    : undefined;
  if (byline === undefined) issues.push(invalidPersistedField("byline"));

  const language =
    row.language === null ? null : parseCanonical(languageSchema, row.language);
  if (language === undefined) issues.push(invalidPersistedField("language"));

  const rawCover =
    row.cover === null
      ? { ok: true as const, value: null }
      : parseJson(row.cover);
  const cover = rawCover.ok
    ? parseCanonical(coverSchema.nullable(), rawCover.value)
    : undefined;
  if (cover === undefined) issues.push(invalidPersistedField("cover"));

  const rawDocument = parseJson(row.document);
  const document = rawDocument.ok
    ? documentEnvelopeSchema.safeParse(rawDocument.value)
    : null;
  if (!document?.success) issues.push(invalidPersistedField("document"));

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    draft: {
      articleId: articleId.data,
      currentPublicationId: currentPublicationId.data,
      version: version.data!,
      title: title!,
      slug: slug!,
      summary: summary!,
      tags: tags!,
      byline: byline!,
      language: language!,
      cover: cover!,
      document: document!.data!,
    },
  };
}

async function readSavedDraft(
  database: D1Database,
  articleId: string,
): Promise<SavedDraftRow | null> {
  try {
    return await database
      .prepare(
        `SELECT article.id, article.current_publication_id,
                article_draft.version, article_draft.title, article_draft.slug,
                article_draft.summary, article_draft.tags,
                article_draft.byline, article_draft.language,
                article_draft.cover, article_draft.document
         FROM article
         JOIN article_draft ON article_draft.article_id = article.id
         WHERE article.id = ? AND article.trashed_at IS NULL
         LIMIT 1`,
      )
      .bind(articleId)
      .first<SavedDraftRow>();
  } catch (error) {
    throw new PublicationWorkflowError("PUBLICATION_NOT_COMPLETED", error);
  }
}

function hasSubstantiveContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSubstantiveContent);
  if (value === null || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node.type === "figure" || node.type === "videoEmbed") return true;
  if (
    node.type === "text" &&
    typeof node.text === "string" &&
    node.text.trim().length > 0
  ) {
    return true;
  }
  return hasSubstantiveContent(node.content);
}

async function resolveMetadata(
  database: D1Database,
  draft: SavedDraft,
): Promise<{ metadata?: ResolvedMetadata; issues: PhasedIssue[] }> {
  const issues: PhasedIssue[] = [];
  let defaultByline: Byline | undefined;
  let defaultLanguage: string | undefined;
  if (draft.byline === null || draft.language === null) {
    const selected = [
      ...(draft.byline === null
        ? ["default_byline_name", "default_byline_url"]
        : []),
      ...(draft.language === null ? ["default_language"] : []),
    ];
    let row: Record<string, unknown> | null;
    try {
      row = await database
        .prepare(
          `SELECT ${selected.join(", ")} FROM site_settings WHERE id = 1`,
        )
        .first<Record<string, unknown>>();
    } catch (error) {
      throw new PublicationWorkflowError("PUBLICATION_NOT_COMPLETED", error);
    }
    if (!row) {
      throw new PublicationWorkflowError(
        "PUBLICATION_NOT_COMPLETED",
        new Error("Publication settings row is absent"),
      );
    }
    if (draft.byline === null) {
      const parsed = parseCanonical(bylineSchema, {
        name: row.default_byline_name,
        url: row.default_byline_url,
      });
      if (parsed) defaultByline = parsed;
      else {
        issues.push(
          issue(
            "metadata",
            "INVALID",
            "draft.byline",
            "A valid Byline is required for publication.",
          ),
        );
      }
    }
    if (draft.language === null) {
      const parsed = parseCanonical(languageSchema, row.default_language);
      if (parsed) defaultLanguage = parsed;
      else {
        issues.push(
          issue(
            "metadata",
            "INVALID",
            "draft.language",
            "A valid language is required for publication.",
          ),
        );
      }
    }
  }
  if (issues.length > 0) return { issues };
  return {
    issues,
    metadata: {
      byline: draft.byline ?? defaultByline!,
      language: draft.language ?? defaultLanguage!,
    },
  };
}

const workflowIssueForRendererDiagnostic: Record<
  PublicationRendererDiagnosticCode,
  { code: PublicationIssueCode; message: string }
> = {
  ASSET_NOT_RESOLVED: {
    code: "UNAVAILABLE",
    message: "A referenced Asset is unavailable for publication.",
  },
  FIGURE_ALT_REQUIRED: {
    code: "REQUIRED",
    message: "Alternative text is required for this figure.",
  },
  INVALID_ASSET_IDENTITY: {
    code: "INVALID",
    message: "The saved Draft contains an invalid Asset identity.",
  },
  INVALID_ASSET_RESOLUTION: {
    code: "UNSAFE",
    message: "A referenced Asset has unsafe delivery facts.",
  },
  INVALID_COVER: {
    code: "INVALID",
    message: "The saved Draft cover is invalid.",
  },
  INVALID_DOCUMENT: {
    code: "INVALID",
    message: "The saved Draft Document is invalid.",
  },
  INVALID_DOCUMENT_STRUCTURE: {
    code: "INVALID",
    message: "The saved Draft Document structure is invalid.",
  },
  INVALID_HEADING_LEVEL: {
    code: "INVALID",
    message: "The saved Draft contains an invalid heading level.",
  },
  INVALID_NODE_ATTRIBUTES: {
    code: "INVALID",
    message: "The saved Draft contains invalid Document attributes.",
  },
  INVALID_PROVIDER_IDENTIFIER: {
    code: "INVALID",
    message: "The saved Draft contains an invalid video identifier.",
  },
  UNSAFE_LINK: {
    code: "UNSAFE",
    message: "The saved Draft contains an unsafe link.",
  },
  UNSUPPORTED_DOCUMENT_SCHEMA_VERSION: {
    code: "UNSUPPORTED",
    message: "The saved Draft uses an unsupported Document Schema Version.",
  },
  UNSUPPORTED_MARK: {
    code: "UNSUPPORTED",
    message: "The saved Draft contains an unsupported Document mark.",
  },
  UNSUPPORTED_NODE: {
    code: "UNSUPPORTED",
    message: "The saved Draft contains an unsupported Document node.",
  },
};

function rendererIssue(diagnostic: PublicationRendererDiagnostic): PhasedIssue {
  let phase: IssuePhase = "document";
  let path = `draft.document.${diagnostic.path}`;
  if (diagnostic.path === "cover" || diagnostic.path.startsWith("cover.")) {
    path = `draft.${diagnostic.path}`;
  } else if (diagnostic.path.startsWith("assets.")) {
    phase = "assets";
    path = `draft.${diagnostic.path}`;
  }

  const mapped = workflowIssueForRendererDiagnostic[diagnostic.code];
  return issue(phase, mapped.code, path, mapped.message);
}

async function prepareSavedDraft(
  database: D1Database,
  articleId: string,
  draftVersion: number,
  resolveAsset: PublicationRendererDependencies["resolveAsset"],
  resolvedAssets: Map<string, PublicationAssetResolution>,
): Promise<PreparationResult> {
  const row = await readSavedDraft(database, articleId);
  if (!row) return { ok: false, reason: "not-found" };
  const decoded = decodeSavedDraft(row);
  if (!decoded.ok) {
    return {
      ok: false,
      reason: "invalid",
      issues: canonicalIssues(decoded.issues),
    };
  }
  const draft = decoded.draft;
  if (draft.version !== draftVersion) return { ok: false, reason: "conflict" };

  const readiness: PhasedIssue[] = [];
  if (draft.title.length === 0) {
    readiness.push(
      issue(
        "metadata",
        "REQUIRED",
        "draft.title",
        "A title is required for publication.",
      ),
    );
  }
  if (draft.slug === null) {
    readiness.push(
      issue(
        "metadata",
        "REQUIRED",
        "draft.slug",
        "A slug is required for publication.",
      ),
    );
  }
  if (!hasSubstantiveContent(draft.document.doc)) {
    readiness.push(
      issue(
        "metadata",
        "REQUIRED",
        "draft.document.doc",
        "Substantive body content is required for publication.",
      ),
    );
  }
  const resolvedMetadata = await resolveMetadata(database, draft);
  readiness.push(...resolvedMetadata.issues);
  if (readiness.length > 0) {
    return {
      ok: false,
      reason: "invalid",
      issues: canonicalIssues(readiness),
    };
  }

  let rendered;
  try {
    rendered = await renderPublication(
      draft.document,
      { resolveAsset },
      draft.cover,
    );
  } catch (error) {
    if (error instanceof PublicationAssetAdapterError) {
      throw new PublicationWorkflowError(
        "PUBLICATION_NOT_COMPLETED",
        error.cause,
      );
    }
    throw error;
  }
  if (!rendered.ok) {
    return {
      ok: false,
      reason: "invalid",
      issues: canonicalIssues(rendered.issues.map(rendererIssue)),
    };
  }
  return {
    ok: true,
    prepared: {
      draft,
      metadata: resolvedMetadata.metadata!,
      rendered: rendered.value,
      resolvedAssets,
    },
  };
}

function workflowAssetResolver(
  resolve: PublicationRendererDependencies["resolveAsset"],
): PublicationRendererDependencies["resolveAsset"] {
  return async (assetId) => {
    try {
      return await resolve(assetId);
    } catch (error) {
      throw new PublicationAssetAdapterError(error);
    }
  };
}

export async function previewSavedDraft(
  database: D1Database,
  bucket: R2Bucket,
  applicationOrigin: string,
  command: PreviewSavedDraftCommand,
): Promise<PublicationWorkflowResult<PublicationPreview>> {
  const resolvedAssets = new Map<string, PublicationAssetResolution>();
  const prepared = await prepareSavedDraft(
    database,
    command.articleId,
    command.draftVersion,
    workflowAssetResolver((assetId) =>
      resolvePrivateAssetForRendering(
        database,
        bucket,
        applicationOrigin,
        assetId,
      ),
    ),
    resolvedAssets,
  );
  if (!prepared.ok) return prepared;
  const { draft, metadata, rendered } = prepared.prepared;
  return {
    ok: true,
    value: {
      articleId: draft.articleId,
      draftVersion: draft.version,
      documentSchemaVersion: draft.document.documentSchemaVersion,
      metadata: {
        title: draft.title,
        slug: draft.slug!,
        summary: draft.summary,
        tags: draft.tags,
        byline: metadata.byline,
        language: metadata.language,
      },
      rendererVersion: rendered.rendererVersion,
      coverHtml: rendered.coverHtml ?? null,
      html: rendered.html,
    },
  };
}

function resultChanges(result: D1Result<unknown> | undefined): number | null {
  return result && Number.isInteger(result.meta.changes)
    ? result.meta.changes
    : null;
}

async function reconcileCommit(
  database: D1Database,
  publicationId: string,
  draftVersion: number,
  articleId: string,
): Promise<PublicationReceipt | null | "rolled-back"> {
  try {
    const article = await confirmCurrentPublicArticle(
      database,
      articleId,
      publicationId,
    );
    if (article) return { publicationId, draftVersion, article };
    const publication = await database
      .prepare(
        "SELECT 1 AS present FROM publication WHERE id = ? AND article_id = ?",
      )
      .bind(publicationId, articleId)
      .first<{ present: number }>();
    return publication ? null : "rolled-back";
  } catch {
    return null;
  }
}

async function readPublicationGuardState(
  database: D1Database,
  articleId: string,
): Promise<{
  draftVersion: number;
  currentPublicationId: string | null;
} | null> {
  const row = await database
    .prepare(
      `SELECT article_draft.version AS draft_version,
              article.current_publication_id
       FROM article
       JOIN article_draft ON article_draft.article_id = article.id
       WHERE article.id = ? AND article.trashed_at IS NULL
       LIMIT 1`,
    )
    .bind(articleId)
    .first<{
      draft_version: unknown;
      current_publication_id: unknown;
    }>();
  if (!row) return null;
  const parsed = z
    .object({
      draft_version: z.number().int().positive(),
      current_publication_id: z.string().uuid().nullable(),
    })
    .parse(row);
  return {
    draftVersion: parsed.draft_version,
    currentPublicationId: parsed.current_publication_id,
  };
}

async function nextPublicationTimestamp(
  database: D1Database,
  articleId: string,
  expectedCurrentPublicationId: string | null,
): Promise<number> {
  const now = Date.now();
  if (expectedCurrentPublicationId === null) return now;

  let row: { published_at: unknown } | null;
  try {
    row = await database
      .prepare(
        "SELECT published_at FROM publication WHERE id = ? AND article_id = ?",
      )
      .bind(expectedCurrentPublicationId, articleId)
      .first<{ published_at: unknown }>();
  } catch (error) {
    throw new PublicationWorkflowError("PUBLICATION_NOT_COMPLETED", error);
  }
  if (!row) return now;

  const previous = z
    .number()
    .int()
    .nonnegative()
    .max(8_639_999_999_999_999)
    .parse(row.published_at);
  return Math.max(now, previous + 1);
}

async function commitPublication(
  database: D1Database,
  command: PublishSavedDraftCommand,
  prepared: PreparedPublication,
): Promise<PublicationWorkflowResult<PublicationReceipt>> {
  const { draft, metadata, rendered, resolvedAssets } = prepared;
  const publicationId = crypto.randomUUID();
  const publishedAt = await nextPublicationTimestamp(
    database,
    command.articleId,
    command.expectedCurrentPublicationId,
  );
  const slug = draft.slug!;
  const slugKey = articleSlugKey(slug);
  let cover: PublicArticleCover | null = null;
  if (draft.cover) {
    const asset = resolvedAssets.get(draft.cover.assetId);
    if (!asset) throw new Error("Rendered cover Asset resolution is absent");
    cover = {
      url: asset.publicUrl,
      width: asset.width,
      height: asset.height,
      alt: draft.cover.alt,
    };
  }

  const statements: D1PreparedStatement[] = [];
  const publicationIndex = statements.length;
  statements.push(
    database
      .prepare(
        `INSERT INTO publication
           (id, article_id, slug, slug_key, publication_number, title,
            summary, tags, byline, language, cover, document_schema_version,
            document, renderer_version, provider_facts, html, published_at,
            created_at)
         SELECT ?, ?, ?, ?,
                COALESCE(
                  (SELECT MAX(publication_number) + 1
                   FROM publication WHERE article_id = ?),
                  1
                ),
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM article_draft
           JOIN article ON article.id = article_draft.article_id
           WHERE article_draft.article_id = ?
             AND article_draft.version = ?
             AND article.current_publication_id IS ?
             AND article.trashed_at IS NULL
         )`,
      )
      .bind(
        publicationId,
        command.articleId,
        slug,
        slugKey,
        command.articleId,
        draft.title,
        draft.summary,
        JSON.stringify(draft.tags),
        JSON.stringify(metadata.byline),
        metadata.language,
        cover === null ? null : JSON.stringify(cover),
        draft.document.documentSchemaVersion,
        JSON.stringify(draft.document),
        rendered.rendererVersion,
        JSON.stringify(rendered.referencedProviders),
        rendered.html,
        publishedAt,
        publishedAt,
        command.articleId,
        command.draftVersion,
        command.expectedCurrentPublicationId,
      ),
  );

  const mutationIndexes: number[] = [];
  mutationIndexes.push(statements.length);
  statements.push(
    database
      .prepare(
        `UPDATE article_slug
         SET was_published = 1
         WHERE slug_key = ? AND article_id = ?
           AND EXISTS (
             SELECT 1 FROM publication
             WHERE id = ? AND article_id = ?
           )`,
      )
      .bind(slugKey, command.articleId, publicationId, command.articleId),
  );
  for (const asset of resolvedAssets.values()) {
    mutationIndexes.push(statements.length);
    statements.push(
      database
        .prepare(
          `UPDATE asset
           SET public_asset_id = COALESCE(public_asset_id, ?)
           WHERE id = ? AND lifecycle_state = 'ready'
             AND (public_asset_id IS NULL OR public_asset_id = ?)
             AND EXISTS (
               SELECT 1 FROM publication
               WHERE id = ? AND article_id = ?
             )`,
        )
        .bind(
          asset.publicAssetId,
          asset.assetId,
          asset.publicAssetId,
          publicationId,
          command.articleId,
        ),
    );
  }
  for (const asset of resolvedAssets.values()) {
    mutationIndexes.push(statements.length);
    statements.push(
      database
        .prepare(
          `INSERT INTO publication_asset_reference
             (publication_id, asset_id, public_asset_id, asset_lifecycle_state)
           SELECT ?, ?, ?, 'ready'
           WHERE EXISTS (
             SELECT 1 FROM publication WHERE id = ? AND article_id = ?
           )`,
        )
        .bind(
          publicationId,
          asset.assetId,
          asset.publicAssetId,
          publicationId,
          command.articleId,
        ),
    );
  }
  mutationIndexes.push(statements.length);
  statements.push(
    database
      .prepare(
        `UPDATE article
         SET current_publication_id = ?,
             published_at = COALESCE(published_at, ?),
             updated_at = ?
         WHERE id = ? AND current_publication_id IS ?
           AND EXISTS (
             SELECT 1 FROM publication
             WHERE id = ? AND article_id = article.id
           )
           AND EXISTS (
             SELECT 1 FROM article_draft
             WHERE article_id = article.id AND version = ?
           )`,
      )
      .bind(
        publicationId,
        publishedAt,
        publishedAt,
        command.articleId,
        command.expectedCurrentPublicationId,
        publicationId,
        command.draftVersion,
      ),
  );

  let batch: D1Result<unknown>[];
  try {
    batch = await database.batch(statements);
  } catch (error) {
    const reconciled = await reconcileCommit(
      database,
      publicationId,
      command.draftVersion,
      command.articleId,
    );
    if (reconciled && reconciled !== "rolled-back") {
      return { ok: true, value: reconciled };
    }
    throw new PublicationWorkflowError(
      reconciled === "rolled-back"
        ? "PUBLICATION_NOT_COMPLETED"
        : "PUBLICATION_STATE_UNCONFIRMED",
      error,
    );
  }

  const publicationChanges = resultChanges(batch[publicationIndex]);
  const mutationChanges = mutationIndexes.map((index) =>
    resultChanges(batch[index]),
  );
  const allCommitted =
    publicationChanges === 1 &&
    mutationChanges.every((changes) => changes === 1);
  const cleanGuardMiss =
    publicationChanges === 0 &&
    mutationChanges.every((changes) => changes === 0);

  if (allCommitted) {
    const receipt = await reconcileCommit(
      database,
      publicationId,
      command.draftVersion,
      command.articleId,
    );
    if (receipt && receipt !== "rolled-back") {
      return { ok: true, value: receipt };
    }
    throw new PublicationWorkflowError(
      receipt === "rolled-back"
        ? "PUBLICATION_NOT_COMPLETED"
        : "PUBLICATION_STATE_UNCONFIRMED",
    );
  }
  if (cleanGuardMiss) {
    const reconciled = await reconcileCommit(
      database,
      publicationId,
      command.draftVersion,
      command.articleId,
    );
    if (reconciled && reconciled !== "rolled-back") {
      return { ok: true, value: reconciled };
    }
    if (reconciled === null) {
      throw new PublicationWorkflowError("PUBLICATION_STATE_UNCONFIRMED");
    }
    try {
      const current = await readPublicationGuardState(
        database,
        command.articleId,
      );
      if (!current) return { ok: false, reason: "not-found" };
      if (
        current.draftVersion !== command.draftVersion ||
        current.currentPublicationId !== command.expectedCurrentPublicationId
      ) {
        return { ok: false, reason: "conflict" };
      }
      throw new PublicationWorkflowError("PUBLICATION_NOT_COMPLETED");
    } catch (error) {
      if (isPublicationWorkflowError(error)) throw error;
      throw new PublicationWorkflowError(
        "PUBLICATION_STATE_UNCONFIRMED",
        error,
      );
    }
  }

  const reconciled = await reconcileCommit(
    database,
    publicationId,
    command.draftVersion,
    command.articleId,
  );
  if (reconciled && reconciled !== "rolled-back") {
    return { ok: true, value: reconciled };
  }
  throw new PublicationWorkflowError(
    reconciled === "rolled-back"
      ? "PUBLICATION_NOT_COMPLETED"
      : "PUBLICATION_STATE_UNCONFIRMED",
  );
}

export async function publishSavedDraft(
  database: D1Database,
  bucket: R2Bucket,
  applicationOrigin: string,
  command: PublishSavedDraftCommand,
): Promise<PublicationWorkflowResult<PublicationReceipt>> {
  const resolvedAssets = new Map<string, PublicationAssetResolution>();
  const prepared = await prepareSavedDraft(
    database,
    command.articleId,
    command.draftVersion,
    workflowAssetResolver(async (assetId) => {
      const resolution = await resolveAssetForPublication(
        database,
        bucket,
        applicationOrigin,
        assetId,
      );
      if (resolution && !("rejection" in resolution)) {
        resolvedAssets.set(assetId, resolution);
      }
      return resolution;
    }),
    resolvedAssets,
  );
  if (!prepared.ok) return prepared;
  return commitPublication(database, command, prepared.prepared);
}
