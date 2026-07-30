import { z } from "zod";

import {
  ARTICLE_ASSET_ALT_MAXIMUM_LENGTH,
  ARTICLE_DOCUMENT_SCHEMA_VERSION,
  ARTICLE_SLUG_MAXIMUM_LENGTH,
  ARTICLE_SUMMARY_MAXIMUM_LENGTH,
  ARTICLE_TAG_MAXIMUM_LENGTH,
  ARTICLE_TAGS_MAXIMUM_COUNT,
  ARTICLE_TITLE_MAXIMUM_LENGTH,
  type Article,
  type ArticleCoverUsage,
} from "./articles";
import {
  articleDocumentAssetReferences,
  validateArticleDocument,
} from "./article-document";

const emptyDocument = {
  documentSchemaVersion: ARTICLE_DOCUMENT_SCHEMA_VERSION,
  doc: { type: "doc", content: [{ type: "paragraph" }] },
} as const;

const bylineUrl = z
  .string()
  .max(2_048)
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "Use an HTTP or HTTPS URL.",
  })
  .transform((value) => new URL(value).toString());

const byline = z.object({
  name: z.string().trim().min(1).max(120),
  url: bylineUrl.nullable(),
});

const language = z
  .string()
  .max(35)
  .superRefine((value, context) => {
    try {
      if (Intl.getCanonicalLocales(value).length !== 1) throw new Error();
    } catch {
      context.addIssue({
        code: "custom",
        message: "Use a valid BCP 47 language tag, such as en or zh-Hans.",
      });
    }
  })
  .transform((value) => Intl.getCanonicalLocales(value)[0]);

const coverUsage = z
  .object({
    assetId: z.string().uuid({
      message: "A cover must reference an existing internal Asset.",
    }),
    alt: z
      .string()
      .trim()
      .min(1, { message: "A cover requires meaningful alternative text." })
      .max(ARTICLE_ASSET_ALT_MAXIMUM_LENGTH),
  })
  .strict();

const pathReservedCharacter = /[:/?#\[\]@!$&'()*+,;=%\\]/u;
const controlCharacter = /\p{Cc}/u;

function slugKeyFor(value: string | null): string | null {
  return value?.toLocaleLowerCase("und") ?? null;
}

const slug = z
  .string()
  .max(ARTICLE_SLUG_MAXIMUM_LENGTH)
  .transform((value) => value.normalize("NFC").trim())
  .pipe(z.string().min(1, { message: "Enter a slug or leave it absent." }))
  .refine((value) => !controlCharacter.test(value), {
    message: "Slug cannot contain control characters.",
  })
  .refine((value) => !pathReservedCharacter.test(value), {
    message: "Slug cannot contain path-reserved characters.",
  });

const tag = z
  .string()
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(ARTICLE_TAG_MAXIMUM_LENGTH))
  .transform((value) => value.toLocaleLowerCase("und"));

const draftInput = z
  .object({
    version: z.number().int().positive(),
    title: z.string().trim().max(ARTICLE_TITLE_MAXIMUM_LENGTH),
    slug: slug.nullable(),
    summary: z.string().max(ARTICLE_SUMMARY_MAXIMUM_LENGTH).nullable(),
    tags: z.array(tag).max(ARTICLE_TAGS_MAXIMUM_COUNT),
    byline: byline.nullable(),
    language: language.nullable(),
    cover: coverUsage.nullable().optional(),
    document: z.unknown().optional(),
  })
  .strict()
  .transform((value) => ({
    ...value,
    tags: [...new Set(value.tags)],
  }));

const persistedArticleBase = z.object({
  id: z.string().uuid(),
  current_publication_id: z.string().nullable(),
  article_created_at: z.number().int(),
  article_updated_at: z.number().int(),
  version: z.number().int().positive(),
  title: z.string(),
  slug: z.string().nullable(),
  summary: z.string().nullable(),
  tags: z.string().transform((value, context) => {
    try {
      return z.array(z.string()).parse(JSON.parse(value));
    } catch {
      context.addIssue({ code: "custom", message: "Invalid persisted tags" });
      return z.NEVER;
    }
  }),
  byline: z
    .string()
    .nullable()
    .transform((value, context) => {
      if (value === null) return null;
      try {
        return byline.parse(JSON.parse(value));
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid persisted Byline",
        });
        return z.NEVER;
      }
    }),
  language: z.string().nullable(),
  cover: z
    .string()
    .nullable()
    .transform((value, context): ArticleCoverUsage | null => {
      if (value === null) return null;
      try {
        return coverUsage.parse(JSON.parse(value));
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid persisted cover",
        });
        return z.NEVER;
      }
    }),
  draft_created_at: z.number().int(),
  draft_updated_at: z.number().int(),
});

function persistedArticleDocument<T>(parse: (input: unknown) => T) {
  return z.string().transform((value, context) => {
    try {
      return parse(JSON.parse(value));
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid persisted Article document",
      });
      return z.NEVER;
    }
  });
}

const persistedArticle = persistedArticleBase.extend({
  document: persistedArticleDocument((input) => {
    const result = validateArticleDocument(input);
    if (result.ok) return result.document;
    throw new Error("Invalid Article document");
  }),
});

const articleDocumentEnvelope = z
  .object({
    documentSchemaVersion: z.number(),
    doc: z.unknown(),
  })
  .passthrough();

const persistedArticleForRendering = persistedArticleBase.extend({
  document: persistedArticleDocument((input) =>
    articleDocumentEnvelope.parse(input),
  ),
});

type ArticleRow = z.input<typeof persistedArticle>;

type ArticleDraftMetadata = Pick<
  Article["draft"],
  | "version"
  | "title"
  | "slug"
  | "summary"
  | "tags"
  | "byline"
  | "language"
  | "cover"
>;

export class NonCanonicalArticleDraftMetadataError extends Error {
  constructor() {
    super("Article Draft metadata is not canonically persisted");
    this.name = "NonCanonicalArticleDraftMetadataError";
  }
}

function articleDraftMetadataFromRow(
  row: z.output<typeof persistedArticleBase>,
): ArticleDraftMetadata {
  const parsed = draftInput.parse({
    version: row.version,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    tags: row.tags,
    byline: row.byline,
    language: row.language,
    cover: row.cover,
  });
  const metadata = {
    version: parsed.version,
    title: parsed.title,
    slug: parsed.slug,
    summary: parsed.summary,
    tags: parsed.tags,
    byline: parsed.byline,
    language: parsed.language,
    cover: parsed.cover ?? null,
  };
  const persistedMetadata = {
    version: row.version,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    tags: row.tags,
    byline: row.byline,
    language: row.language,
    cover: row.cover,
  };
  if (JSON.stringify(metadata) !== JSON.stringify(persistedMetadata)) {
    throw new NonCanonicalArticleDraftMetadataError();
  }
  return metadata;
}

function articleFromRow(input: ArticleRow): Article {
  const row = persistedArticle.parse(input);
  const metadata = articleDraftMetadataFromRow(row);
  return {
    id: row.id,
    currentPublicationId: row.current_publication_id,
    createdAt: new Date(row.article_created_at).toISOString(),
    updatedAt: new Date(row.article_updated_at).toISOString(),
    draft: {
      ...metadata,
      document: row.document,
      createdAt: new Date(row.draft_created_at).toISOString(),
      updatedAt: new Date(row.draft_updated_at).toISOString(),
    },
  };
}

const articleSelection = `
  SELECT article.id, article.current_publication_id,
         article.created_at AS article_created_at,
         article.updated_at AS article_updated_at,
         article_draft.version, article_draft.title, article_draft.slug,
         article_draft.summary, article_draft.tags, article_draft.byline,
         article_draft.language, article_draft.cover, article_draft.document,
         article_draft.created_at AS draft_created_at,
         article_draft.updated_at AS draft_updated_at
  FROM article
  JOIN article_draft ON article_draft.article_id = article.id
`;

export interface ArticleValidationIssue {
  path: string;
  message: string;
}

interface DraftAssetReference {
  assetId: string;
  path: string;
}

function draftAssetReferences(
  document: Article["draft"]["document"],
  cover: ArticleCoverUsage | null,
): DraftAssetReference[] {
  return [
    ...(cover ? [{ assetId: cover.assetId, path: "cover.assetId" }] : []),
    ...articleDocumentAssetReferences(document).map(({ assetId, path }) => ({
      assetId,
      path: `document.${path}`,
    })),
  ];
}

async function unavailableDraftAssetIssues(
  database: D1Database,
  references: DraftAssetReference[],
): Promise<ArticleValidationIssue[]> {
  const assetIds = [...new Set(references.map(({ assetId }) => assetId))];
  if (assetIds.length === 0) return [];
  const { results } = await database
    .prepare(
      `SELECT requested.value AS asset_id
       FROM json_each(?) AS requested
       LEFT JOIN asset
         ON asset.id = requested.value AND asset.lifecycle_state = 'ready'
       WHERE asset.id IS NULL`,
    )
    .bind(JSON.stringify(assetIds))
    .all<{ asset_id: string }>();
  const unavailable = new Set(results.map(({ asset_id }) => asset_id));
  return references
    .filter(({ assetId }) => unavailable.has(assetId))
    .map(({ path }) => ({
      path,
      message: "Referenced Asset must exist and be ready.",
    }));
}

export type UpdateArticleDraftResult =
  | { ok: true; article: Article }
  | { ok: false; reason: "invalid"; issues: ArticleValidationIssue[] }
  | { ok: false; reason: "conflict" | "not-found" | "slug-conflict" };

export async function createArticle(database: D1Database): Promise<Article> {
  const id = crypto.randomUUID();
  const now = Date.now();
  await database.batch([
    database
      .prepare(
        "INSERT INTO article (id, created_at, updated_at) VALUES (?, ?, ?)",
      )
      .bind(id, now, now),
    database
      .prepare(
        `INSERT INTO article_draft
           (article_id, version, title, slug, slug_key, summary, tags,
            byline, language, cover, document, created_at, updated_at)
         VALUES (?, 1, '', NULL, NULL, NULL, '[]', NULL, NULL, NULL, ?, ?, ?)`,
      )
      .bind(id, JSON.stringify(emptyDocument), now, now),
  ]);
  const created = await readArticle(database, id);
  if (!created) throw new Error("Created Article could not be read");
  return created;
}

export async function listArticles(database: D1Database): Promise<Article[]> {
  const { results } = await database
    .prepare(
      `${articleSelection}
       WHERE article.trashed_at IS NULL
       ORDER BY article.updated_at DESC, article.id ASC`,
    )
    .all<ArticleRow>();
  return results.map(articleFromRow);
}

export async function readArticle(
  database: D1Database,
  articleId: string,
): Promise<Article | null> {
  const row = await database
    .prepare(
      `${articleSelection}
       WHERE article.id = ? AND article.trashed_at IS NULL
       LIMIT 1`,
    )
    .bind(articleId)
    .first<ArticleRow>();
  return row ? articleFromRow(row) : null;
}

export interface ArticleDraftRenderingSource {
  id: string;
  draft: ArticleDraftMetadata & {
    document: {
      documentSchemaVersion: number;
      doc: unknown;
    };
  };
}

export async function readArticleDraftForRendering(
  database: D1Database,
  articleId: string,
): Promise<ArticleDraftRenderingSource | null> {
  const row = await database
    .prepare(
      `${articleSelection}
       WHERE article.id = ? AND article.trashed_at IS NULL
       LIMIT 1`,
    )
    .bind(articleId)
    .first<ArticleRow>();
  if (!row) return null;

  const persisted = persistedArticleForRendering.parse(row);
  return {
    id: persisted.id,
    draft: {
      ...articleDraftMetadataFromRow(persisted),
      document: persisted.document,
    },
  };
}

export async function updateArticleDraft(
  database: D1Database,
  articleId: string,
  input: unknown,
): Promise<UpdateArticleDraftResult> {
  const parsed = draftInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }

  const value = parsed.data;
  const slugKey = slugKeyFor(value.slug);
  const now = Date.now();
  const before = await readArticle(database, articleId);
  if (!before) return { ok: false, reason: "not-found" };
  if (before.draft.version !== value.version)
    return { ok: false, reason: "conflict" };
  const documentResult = validateArticleDocument(
    value.document ?? before.draft.document,
  );
  if (!documentResult.ok) {
    return {
      ok: false,
      reason: "invalid",
      issues: documentResult.issues.map((issue) => ({
        path: `document.${issue.path}`,
        message: issue.message,
      })),
    };
  }
  const cover = value.cover === undefined ? before.draft.cover : value.cover;
  const assetReferences = draftAssetReferences(documentResult.document, cover);
  const assetIssues = await unavailableDraftAssetIssues(
    database,
    assetReferences,
  );
  if (assetIssues.length > 0) {
    return { ok: false, reason: "invalid", issues: assetIssues };
  }
  const assetIds = [...new Set(assetReferences.map(({ assetId }) => assetId))];
  const serializedCover = cover === null ? null : JSON.stringify(cover);
  const serializedDocument = JSON.stringify(documentResult.document);
  const previousSlugKey = slugKeyFor(before.draft.slug);
  const statements: D1PreparedStatement[] = [];
  if (slugKey !== null) {
    statements.push(
      database
        .prepare(
          `INSERT INTO article_slug (slug_key, article_id, was_published)
             SELECT ?, ?, 0
             WHERE EXISTS (
               SELECT 1 FROM article_draft
               WHERE article_id = ? AND version = ?
             )
               AND NOT EXISTS (
                 SELECT 1
                 FROM json_each(?) AS referenced
                 LEFT JOIN asset
                   ON asset.id = referenced.value
                     AND asset.lifecycle_state = 'ready'
                 WHERE asset.id IS NULL
               )
             ON CONFLICT (slug_key) DO NOTHING`,
        )
        .bind(
          slugKey,
          articleId,
          articleId,
          value.version,
          JSON.stringify(assetIds),
        ),
    );
  }
  const updateIndex = statements.length;
  statements.push(
    database
      .prepare(
        `UPDATE article_draft
         SET version = version + 1, title = ?, slug = ?, slug_key = ?,
             summary = ?, tags = ?, byline = ?, language = ?, cover = ?, document = ?,
             updated_at = ?
         WHERE article_id = ? AND version = ?
           AND (
             ? IS NULL OR EXISTS (
               SELECT 1 FROM article_slug
               WHERE article_slug.slug_key = ?
                 AND article_slug.article_id = article_draft.article_id
             )
           )
           AND EXISTS (
             SELECT 1 FROM article
             WHERE article.id = article_draft.article_id
               AND article.trashed_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM json_each(?) AS referenced
             LEFT JOIN asset
               ON asset.id = referenced.value
                 AND asset.lifecycle_state = 'ready'
             WHERE asset.id IS NULL
           )
         RETURNING version`,
      )
      .bind(
        value.title,
        value.slug,
        slugKey,
        value.summary,
        JSON.stringify(value.tags),
        value.byline === null ? null : JSON.stringify(value.byline),
        value.language,
        serializedCover,
        serializedDocument,
        now,
        articleId,
        value.version,
        slugKey,
        slugKey,
        JSON.stringify(assetIds),
      ),
  );
  statements.push(
    database
      .prepare(
        `DELETE FROM article_draft_asset_reference
         WHERE article_id = ?
           AND EXISTS (
             SELECT 1 FROM article_draft
             WHERE article_draft.article_id = ?
               AND article_draft.version = ?
               AND article_draft.updated_at = ?
               AND article_draft.cover IS ?
               AND article_draft.document = ?
           )`,
      )
      .bind(
        articleId,
        articleId,
        value.version + 1,
        now,
        serializedCover,
        serializedDocument,
      ),
  );
  statements.push(
    database
      .prepare(
        `INSERT INTO article_draft_asset_reference (article_id, asset_id)
         SELECT ?, referenced.value
         FROM json_each(?) AS referenced
         WHERE EXISTS (
           SELECT 1 FROM article_draft
           WHERE article_draft.article_id = ?
             AND article_draft.version = ?
             AND article_draft.updated_at = ?
             AND article_draft.cover IS ?
             AND article_draft.document = ?
         )
         ON CONFLICT (article_id, asset_id) DO NOTHING`,
      )
      .bind(
        articleId,
        JSON.stringify(assetIds),
        articleId,
        value.version + 1,
        now,
        serializedCover,
        serializedDocument,
      ),
  );
  if (previousSlugKey !== null && previousSlugKey !== slugKey) {
    statements.push(
      database
        .prepare(
          `DELETE FROM article_slug
             WHERE slug_key = ? AND article_id = ? AND was_published = 0
               AND NOT EXISTS (
                 SELECT 1 FROM article_draft
                 WHERE article_draft.slug_key = article_slug.slug_key
                   AND article_draft.article_id = article_slug.article_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM publication
                 WHERE publication.slug_key = article_slug.slug_key
                   AND publication.article_id = article_slug.article_id
               )`,
        )
        .bind(previousSlugKey, articleId),
    );
  }
  statements.push(
    database
      .prepare(
        `UPDATE article
         SET updated_at = ?
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM article_draft
             WHERE article_draft.article_id = article.id
               AND article_draft.version = ?
               AND article_draft.updated_at = ?
           )`,
      )
      .bind(now, articleId, value.version + 1, now),
  );
  const readIndex = statements.length;
  statements.push(
    database
      .prepare(
        `${articleSelection}
         WHERE article.id = ? AND article.trashed_at IS NULL
         LIMIT 1`,
      )
      .bind(articleId),
  );
  const batch = await database.batch(statements);
  const updated = batch[updateIndex]?.results[0] as
    { version: number } | undefined;
  const row = batch[readIndex]?.results[0] as ArticleRow | undefined;
  const article = row ? articleFromRow(row) : null;

  if (!updated) {
    if (!article) return { ok: false, reason: "not-found" };
    const racedAssetIssues = await unavailableDraftAssetIssues(
      database,
      assetReferences,
    );
    if (racedAssetIssues.length > 0) {
      return { ok: false, reason: "invalid", issues: racedAssetIssues };
    }
    return article.draft.version === value.version
      ? { ok: false, reason: "slug-conflict" }
      : { ok: false, reason: "conflict" };
  }

  if (!article) throw new Error("Updated Article could not be read");
  return { ok: true, article };
}
