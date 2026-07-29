import { z } from "zod";

import {
  ARTICLE_DOCUMENT_SCHEMA_VERSION,
  ARTICLE_SLUG_MAXIMUM_LENGTH,
  ARTICLE_SUMMARY_MAXIMUM_LENGTH,
  ARTICLE_TAG_MAXIMUM_LENGTH,
  ARTICLE_TAGS_MAXIMUM_COUNT,
  ARTICLE_TITLE_MAXIMUM_LENGTH,
  type Article,
} from "./articles";
import { validateArticleDocument } from "./article-document";

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
    document: z.unknown().optional(),
  })
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
  "version" | "title" | "slug" | "summary" | "tags" | "byline" | "language"
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
  });
  const metadata = {
    version: parsed.version,
    title: parsed.title,
    slug: parsed.slug,
    summary: parsed.summary,
    tags: parsed.tags,
    byline: parsed.byline,
    language: parsed.language,
  };
  const persistedMetadata = {
    version: row.version,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    tags: row.tags,
    byline: row.byline,
    language: row.language,
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
         article_draft.language, article_draft.document,
         article_draft.created_at AS draft_created_at,
         article_draft.updated_at AS draft_updated_at
  FROM article
  JOIN article_draft ON article_draft.article_id = article.id
`;

export interface ArticleValidationIssue {
  path: string;
  message: string;
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
            byline, language, document, created_at, updated_at)
         VALUES (?, 1, '', NULL, NULL, NULL, '[]', NULL, NULL, ?, ?, ?)`,
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
             ON CONFLICT (slug_key) DO NOTHING`,
        )
        .bind(slugKey, articleId, articleId, value.version),
    );
  }
  const updateIndex = statements.length;
  statements.push(
    database
      .prepare(
        `UPDATE article_draft
         SET version = version + 1, title = ?, slug = ?, slug_key = ?,
             summary = ?, tags = ?, byline = ?, language = ?, document = ?,
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
        JSON.stringify(documentResult.document),
        now,
        articleId,
        value.version,
        slugKey,
        slugKey,
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
    return article.draft.version === value.version
      ? { ok: false, reason: "slug-conflict" }
      : { ok: false, reason: "conflict" };
  }

  if (!article) throw new Error("Updated Article could not be read");
  return { ok: true, article };
}
