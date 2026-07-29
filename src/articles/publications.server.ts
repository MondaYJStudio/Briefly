import { z } from "zod";

import { readSiteSettings } from "../site-settings/site-settings.server";
import { resolveArticleMetadata } from "../site-settings/site-settings";
import { readArticle } from "./articles.server";
import type { PublicArticle } from "./articles";
import {
  renderPublication,
  type PublicationIssue,
} from "./publication-renderer.server";

export type PublishArticleResult =
  | { ok: true; article: PublicArticle }
  | { ok: false; reason: "invalid"; issues: PublicationIssue[] }
  | {
      ok: false;
      reason: "conflict" | "not-found" | "already-published";
    };

const persistedPublicArticle = z.object({
  id: z.string().uuid(),
  publication_id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  tags: z.string().transform((value, context) => {
    try {
      return z.array(z.string()).parse(JSON.parse(value));
    } catch {
      context.addIssue({ code: "custom", message: "Invalid Publication tags" });
      return z.NEVER;
    }
  }),
  byline: z.string().transform((value, context) => {
    try {
      return z
        .object({ name: z.string().min(1), url: z.string().url().nullable() })
        .parse(JSON.parse(value));
    } catch {
      context.addIssue({
        code: "custom",
        message: "Invalid Publication Byline",
      });
      return z.NEVER;
    }
  }),
  language: z.string().min(1),
  cover: z.null(),
  article_published_at: z.number().int(),
  publication_published_at: z.number().int(),
  html: z.string(),
});

type PublicArticleRow = z.input<typeof persistedPublicArticle>;

function publicArticleFromRow(row: PublicArticleRow): PublicArticle {
  const publication = persistedPublicArticle.parse(row);
  return {
    id: publication.id,
    slug: publication.slug,
    title: publication.title,
    summary: publication.summary,
    tags: publication.tags,
    byline: publication.byline,
    language: publication.language,
    cover: null,
    publishedAt: new Date(publication.article_published_at).toISOString(),
    updatedAt: new Date(publication.publication_published_at).toISOString(),
    html: publication.html,
  };
}

function slugKeyFor(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("und");
}

function publicationMetadataIssues(input: {
  title: string;
  slug: string | null;
  document: unknown;
}): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  if (input.title.trim().length === 0) {
    issues.push({
      code: "TITLE_REQUIRED",
      path: "title",
      message: "A Publication requires a title",
    });
  }
  if (input.slug === null || input.slug.length === 0) {
    issues.push({
      code: "SLUG_REQUIRED",
      path: "slug",
      message: "A Publication requires a canonical slug",
    });
  }

  let hasSubstantiveText = false;
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "text" &&
      typeof node.text === "string" &&
      node.text.trim().length > 0
    ) {
      hasSubstantiveText = true;
    }
    if (node.type === "figure" || node.type === "videoEmbed") {
      issues.push({
        code: "UNSUPPORTED_DOCUMENT_FEATURE",
        path,
        message: `${node.type === "figure" ? "Figures" : "Video embeds"} are not supported by the first Publication tracer`,
      });
    }
    for (const [key, child] of Object.entries(node)) {
      if (Array.isArray(child)) {
        child.forEach((entry, index) =>
          visit(entry, `${path}.${key}.${index}`),
        );
      } else if (child !== null && typeof child === "object") {
        visit(child, `${path}.${key}`);
      }
    }
  };
  visit(input.document, "document");
  if (!hasSubstantiveText) {
    issues.push({
      code: "SUBSTANTIVE_BODY_REQUIRED",
      path: "document.doc",
      message: "A Publication requires substantive text content",
    });
  }
  return issues;
}

export async function publishArticle(
  database: D1Database,
  articleId: string,
  draftVersion: number,
): Promise<PublishArticleResult> {
  let article;
  try {
    article = await readArticle(database, articleId);
  } catch (error) {
    if (
      error instanceof z.ZodError &&
      error.issues.some((issue) => issue.path[0] === "document")
    ) {
      return {
        ok: false,
        reason: "invalid",
        issues: [
          {
            code: "INVALID_DOCUMENT",
            path: "document",
            message: "The saved Draft document is invalid or unsupported",
          },
        ],
      };
    }
    throw error;
  }
  if (!article) return { ok: false, reason: "not-found" };
  if (article.currentPublicationId !== null)
    return { ok: false, reason: "already-published" };
  if (article.draft.version !== draftVersion)
    return { ok: false, reason: "conflict" };

  const issues = publicationMetadataIssues(article.draft);
  if (issues.length > 0) return { ok: false, reason: "invalid", issues };

  const settings = await readSiteSettings(database);
  const resolvedMetadata = resolveArticleMetadata(settings, article.draft);
  const rendered = await renderPublication(article.draft.document, {
    resolveAsset: async () => null,
  });
  if (!rendered.ok)
    return { ok: false, reason: "invalid", issues: rendered.issues };

  const publicationId = crypto.randomUUID();
  const slug = article.draft.slug;
  if (slug === null) throw new Error("Validated Publication slug is absent");
  const slugKey = slugKeyFor(slug);
  const publishedAt = Date.now();
  const publishedAtIso = new Date(publishedAt).toISOString();
  const publicArticle: PublicArticle = {
    id: article.id,
    slug,
    title: article.draft.title,
    summary: article.draft.summary,
    tags: article.draft.tags,
    byline: resolvedMetadata.byline,
    language: resolvedMetadata.language,
    cover: null,
    publishedAt: publishedAtIso,
    updatedAt: publishedAtIso,
    html: rendered.value.html,
  };
  const batch = await database.batch([
    database
      .prepare(
        `UPDATE article_slug
         SET was_published = 1
         WHERE slug_key = ? AND article_id = ?
           AND EXISTS (
             SELECT 1
             FROM article_draft
             JOIN article ON article.id = article_draft.article_id
             WHERE article_draft.article_id = ?
               AND article_draft.version = ?
               AND article.current_publication_id IS NULL
               AND article.trashed_at IS NULL
           )`,
      )
      .bind(slugKey, articleId, articleId, draftVersion),
    database
      .prepare(
        `INSERT INTO publication
           (id, article_id, slug, slug_key, publication_number, title,
            summary, tags, byline, language, cover, document_schema_version,
            document, renderer_version, html, published_at, created_at)
         SELECT ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1
           FROM article_draft
           JOIN article ON article.id = article_draft.article_id
           WHERE article_draft.article_id = ?
             AND article_draft.version = ?
             AND article.current_publication_id IS NULL
             AND article.trashed_at IS NULL
         )`,
      )
      .bind(
        publicationId,
        articleId,
        slug,
        slugKey,
        article.draft.title,
        article.draft.summary,
        JSON.stringify(article.draft.tags),
        JSON.stringify(resolvedMetadata.byline),
        resolvedMetadata.language,
        article.draft.document.documentSchemaVersion,
        JSON.stringify(article.draft.document),
        rendered.value.rendererVersion,
        rendered.value.html,
        publishedAt,
        publishedAt,
        articleId,
        draftVersion,
      ),
    database
      .prepare(
        `UPDATE article
         SET current_publication_id = ?,
             published_at = COALESCE(published_at, ?),
             updated_at = ?
         WHERE id = ? AND current_publication_id IS NULL
           AND EXISTS (
             SELECT 1 FROM publication
             WHERE publication.id = ? AND publication.article_id = article.id
           )`,
      )
      .bind(publicationId, publishedAt, publishedAt, articleId, publicationId),
  ]);

  if (
    (batch[1]?.meta.changes ?? 0) !== 1 ||
    (batch[2]?.meta.changes ?? 0) !== 1
  ) {
    const current = await readArticle(database, articleId);
    if (!current) return { ok: false, reason: "not-found" };
    return current.currentPublicationId === null
      ? { ok: false, reason: "conflict" }
      : { ok: false, reason: "already-published" };
  }

  return { ok: true, article: publicArticle };
}

const publicArticleSelection = `
  SELECT article.id, publication.id AS publication_id, publication.slug,
         publication.title, publication.summary, publication.tags,
         publication.byline, publication.language, publication.cover,
         article.published_at AS article_published_at,
         publication.published_at AS publication_published_at,
         publication.html
  FROM article
  JOIN publication ON publication.id = article.current_publication_id
                  AND publication.article_id = article.id
`;

export async function readPublicArticle(
  database: D1Database,
  slug: string,
): Promise<{ article: PublicArticle; publicationId: string } | null> {
  const row = await database
    .prepare(
      `${publicArticleSelection}
       WHERE article.trashed_at IS NULL AND publication.slug_key = ?
       LIMIT 1`,
    )
    .bind(slugKeyFor(slug))
    .first<PublicArticleRow>();
  if (!row) return null;
  const parsed = persistedPublicArticle.parse(row);
  return {
    article: publicArticleFromRow(row),
    publicationId: parsed.publication_id,
  };
}
