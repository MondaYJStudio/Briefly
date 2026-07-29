import { z } from "zod";

import {
  ARTICLE_SLUG_MAXIMUM_LENGTH,
  ARTICLE_SUMMARY_MAXIMUM_LENGTH,
  ARTICLE_TAG_MAXIMUM_LENGTH,
  ARTICLE_TAGS_MAXIMUM_COUNT,
  ARTICLE_TITLE_MAXIMUM_LENGTH,
  type Article,
  type ArticleDraftUpdate,
} from "./articles";

const emptyDocument = {
  documentSchemaVersion: 1,
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
  })
  .transform((value) => ({
    ...value,
    tags: [...new Set(value.tags)],
  }));

const persistedArticle = z.object({
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
  document: z.string().transform((value, context) => {
    try {
      return z
        .object({
          documentSchemaVersion: z.literal(1),
          doc: z.object({
            type: z.literal("doc"),
            content: z.array(z.object({ type: z.literal("paragraph") })),
          }),
        })
        .parse(JSON.parse(value));
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid persisted Article document",
      });
      return z.NEVER;
    }
  }),
  draft_created_at: z.number().int(),
  draft_updated_at: z.number().int(),
});

type ArticleRow = z.input<typeof persistedArticle>;

function articleFromRow(input: ArticleRow): Article {
  const row = persistedArticle.parse(input);
  const metadata = draftInput.parse({
    version: row.version,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    tags: row.tags,
    byline: row.byline,
    language: row.language,
  });
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
    throw new Error("Article Draft metadata is not canonically persisted");
  }
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

  const value: ArticleDraftUpdate = parsed.data;
  const slugKey = value.slug?.toLocaleLowerCase("und") ?? null;
  const now = Date.now();
  try {
    const updated = await database
      .prepare(
        `UPDATE article_draft
         SET version = version + 1, title = ?, slug = ?, slug_key = ?,
             summary = ?, tags = ?, byline = ?, language = ?, updated_at = ?
         WHERE article_id = ? AND version = ?
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
        now,
        articleId,
        value.version,
      )
      .first<{ version: number }>();

    if (!updated) {
      const article = await readArticle(database, articleId);
      return article
        ? { ok: false, reason: "conflict" }
        : { ok: false, reason: "not-found" };
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint")) {
      return { ok: false, reason: "slug-conflict" };
    }
    throw error;
  }

  await database
    .prepare("UPDATE article SET updated_at = ? WHERE id = ?")
    .bind(now, articleId)
    .run();
  const article = await readArticle(database, articleId);
  if (!article) throw new Error("Updated Article could not be read");
  return { ok: true, article };
}
