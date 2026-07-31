import { z } from "zod";

import {
  resolveAssetForPublication,
  type PublicationAssetResolution,
} from "../assets/assets.server";
import { readSiteSettings } from "../site-settings/site-settings.server";
import { resolveArticleMetadata } from "../site-settings/site-settings";
import { normalizeArticleTag, readArticle } from "./articles.server";
import type {
  ArticleCoverUsage,
  PublicArticle,
  PublicArticleCover,
  PublicArticleListItem,
} from "./articles";
import { articleSlugKey } from "./article-slug";
import {
  renderPublication,
  type PublicationIssue,
} from "./publication-renderer.server";

export type PublishArticleResult =
  | { ok: true; article: PublicArticle }
  | { ok: false; reason: "invalid"; issues: PublicationIssue[] }
  | { ok: false; reason: "conflict" | "not-found" };

export type UnpublishArticleResult =
  | {
      ok: true;
      article: { id: string; currentPublicationId: null };
    }
  | { ok: false; reason: "not-found" };

export const PUBLIC_ARTICLE_LIST_DEFAULT_PAGE_SIZE = 20;
export const PUBLIC_ARTICLE_LIST_MAXIMUM_PAGE_SIZE = 100;

export async function unpublishArticle(
  database: D1Database,
  articleId: string,
): Promise<UnpublishArticleResult> {
  const cleared = await database
    .prepare(
      `UPDATE article
       SET current_publication_id = NULL
       WHERE id = ? AND trashed_at IS NULL`,
    )
    .bind(articleId)
    .run();
  if (cleared.meta.changes !== 1) return { ok: false, reason: "not-found" };

  return {
    ok: true,
    article: { id: articleId, currentPublicationId: null },
  };
}

export type ListPublicArticlesResult =
  | {
      ok: true;
      page: {
        items: PublicArticleListItem[];
        nextCursor: string | null;
      };
    }
  | {
      ok: false;
      reason: "invalid-query" | "invalid-cursor" | "stale-cursor";
    };

const publicArticleCover = z.object({
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().min(1),
});

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
  cover: z
    .string()
    .nullable()
    .transform((value, context) => {
      if (value === null) return null;
      try {
        return publicArticleCover.parse(JSON.parse(value));
      } catch {
        context.addIssue({
          code: "custom",
          message: "Invalid Publication cover",
        });
        return z.NEVER;
      }
    }),
  article_published_at: z.number().int(),
  publication_published_at: z.number().int(),
  html: z.string(),
});

type PublicArticleRow = z.input<typeof persistedPublicArticle>;

function publicArticleFromPublication(
  publication: z.output<typeof persistedPublicArticle>,
): PublicArticle {
  return {
    id: publication.id,
    slug: publication.slug,
    title: publication.title,
    summary: publication.summary,
    tags: publication.tags,
    byline: publication.byline,
    language: publication.language,
    cover: publication.cover,
    publishedAt: new Date(publication.article_published_at).toISOString(),
    updatedAt: new Date(publication.publication_published_at).toISOString(),
    html: publication.html,
  };
}

function publicArticleFromRow(row: PublicArticleRow): PublicArticle {
  return publicArticleFromPublication(persistedPublicArticle.parse(row));
}

function publicArticleListItemFromRow(
  row: PublicArticleRow,
): PublicArticleListItem {
  const { html: _html, ...item } = publicArticleFromRow(row);
  return item;
}

function publicationMetadataIssues(input: {
  title: string;
  slug: string | null;
  cover: ArticleCoverUsage | null;
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
  let hasSubstantiveContent = false;
  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (
      node.type === "text" &&
      typeof node.text === "string" &&
      node.text.trim().length > 0
    ) {
      hasSubstantiveContent = true;
    }
    if (node.type === "videoEmbed") {
      hasSubstantiveContent = true;
    }
    if (node.type === "figure") {
      hasSubstantiveContent = true;
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
  if (!hasSubstantiveContent) {
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
  bucket: R2Bucket,
  applicationOrigin: string,
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
  if (article.draft.version !== draftVersion)
    return { ok: false, reason: "conflict" };

  const issues = publicationMetadataIssues(article.draft);
  if (issues.length > 0) return { ok: false, reason: "invalid", issues };

  const settings = await readSiteSettings(database);
  const resolvedMetadata = resolveArticleMetadata(settings, article.draft);
  const resolvedAssets = new Map<string, PublicationAssetResolution>();
  const rendered = await renderPublication(
    article.draft.document,
    {
      resolveAsset: async (assetId) => {
        const resolution = await resolveAssetForPublication(
          database,
          bucket,
          applicationOrigin,
          assetId,
        );
        if (resolution) resolvedAssets.set(assetId, resolution);
        return resolution;
      },
    },
    article.draft.cover,
  );
  if (!rendered.ok)
    return { ok: false, reason: "invalid", issues: rendered.issues };

  let cover: PublicArticleCover | null = null;
  if (article.draft.cover) {
    const asset = resolvedAssets.get(article.draft.cover.assetId);
    if (!asset) throw new Error("Rendered cover Asset resolution is absent");
    cover = {
      url: asset.publicUrl,
      width: asset.width,
      height: asset.height,
      alt: article.draft.cover.alt,
    };
  }

  const publicationId = crypto.randomUUID();
  const slug = article.draft.slug;
  if (slug === null) throw new Error("Validated Publication slug is absent");
  const slugKey = articleSlugKey(slug);
  const publishedAt = Date.now();
  const expectedCurrentPublicationId = article.currentPublicationId;
  const statements: D1PreparedStatement[] = [
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
               AND article.current_publication_id IS ?
               AND article.trashed_at IS NULL
           )`,
      )
      .bind(
        slugKey,
        articleId,
        articleId,
        draftVersion,
        expectedCurrentPublicationId,
      ),
  ];
  for (const asset of resolvedAssets.values()) {
    statements.push(
      database
        .prepare(
          `UPDATE asset
           SET public_asset_id = COALESCE(public_asset_id, ?)
           WHERE id = ? AND lifecycle_state = 'ready'
             AND (public_asset_id IS NULL OR public_asset_id = ?)
             AND EXISTS (
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
          asset.publicAssetId,
          asset.assetId,
          asset.publicAssetId,
          articleId,
          draftVersion,
          expectedCurrentPublicationId,
        ),
    );
  }
  const publicationStatementIndex = statements.length;
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
                  (
                    SELECT MAX(publication_number) + 1
                    FROM publication
                    WHERE article_id = ?
                  ),
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
        articleId,
        slug,
        slugKey,
        articleId,
        article.draft.title,
        article.draft.summary,
        JSON.stringify(article.draft.tags),
        JSON.stringify(resolvedMetadata.byline),
        resolvedMetadata.language,
        cover === null ? null : JSON.stringify(cover),
        article.draft.document.documentSchemaVersion,
        JSON.stringify(article.draft.document),
        rendered.value.rendererVersion,
        JSON.stringify(rendered.value.referencedProviders),
        rendered.value.html,
        publishedAt,
        publishedAt,
        articleId,
        draftVersion,
        expectedCurrentPublicationId,
      ),
  );
  for (const asset of resolvedAssets.values()) {
    statements.push(
      database
        .prepare(
          `INSERT INTO publication_asset_reference
             (publication_id, asset_id, public_asset_id, asset_lifecycle_state)
           SELECT ?, ?, ?, 'ready'
           WHERE EXISTS (
             SELECT 1
             FROM publication
             WHERE id = ? AND article_id = ?
           )`,
        )
        .bind(
          publicationId,
          asset.assetId,
          asset.publicAssetId,
          publicationId,
          articleId,
        ),
    );
  }
  const pointerStatementIndex = statements.length;
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
             WHERE publication.id = ? AND publication.article_id = article.id
           )
           AND EXISTS (
             SELECT 1
             FROM article_draft
             WHERE article_draft.article_id = article.id
               AND article_draft.version = ?
           )`,
      )
      .bind(
        publicationId,
        publishedAt,
        publishedAt,
        articleId,
        expectedCurrentPublicationId,
        publicationId,
        draftVersion,
      ),
  );
  const publicReadStatementIndex = statements.length;
  statements.push(
    database
      .prepare(
        `${publicArticleSelection}
         WHERE article.trashed_at IS NULL
           AND publication.slug_key = ?
           AND publication.id = ?
         LIMIT 1`,
      )
      .bind(slugKey, publicationId),
  );
  const batch = await database.batch<PublicArticleRow>(statements);

  if (
    (batch[publicationStatementIndex]?.meta.changes ?? 0) !== 1 ||
    (batch[pointerStatementIndex]?.meta.changes ?? 0) !== 1
  ) {
    const current = await readArticle(database, articleId);
    if (!current) return { ok: false, reason: "not-found" };
    return { ok: false, reason: "conflict" };
  }

  const publicRead = batch[publicReadStatementIndex]?.results.at(0);
  const published = persistedPublicArticle.safeParse(publicRead);
  if (!published.success || published.data.publication_id !== publicationId) {
    throw new Error(
      "Committed Publication is not immediately publicly readable",
    );
  }
  return { ok: true, article: publicArticleFromPublication(published.data) };
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

const publicArticleListQuery = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PUBLIC_ARTICLE_LIST_MAXIMUM_PAGE_SIZE)
      .default(PUBLIC_ARTICLE_LIST_DEFAULT_PAGE_SIZE),
    tag: z.string().optional(),
  })
  .strict();

const publicArticleListCursor = z
  .object({
    v: z.literal(1),
    publishedAt: z.number().int().nonnegative(),
    articleId: z.string().uuid(),
    tag: z.string().nullable(),
  })
  .strict();

type PublicArticleListCursor = z.infer<typeof publicArticleListCursor>;

function encodePublicArticleListCursor(
  cursor: PublicArticleListCursor,
): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodePublicArticleListCursor(
  encoded: string,
): PublicArticleListCursor | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const parsed = publicArticleListCursor.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return encodePublicArticleListCursor(parsed) === encoded ? parsed : null;
  } catch {
    return null;
  }
}

async function publicArticleListCursorIsCurrent(
  database: D1Database,
  cursor: PublicArticleListCursor,
): Promise<boolean> {
  const tagPredicate = cursor.tag
    ? `AND EXISTS (
         SELECT 1 FROM json_each(publication.tags) AS publication_tag
         WHERE publication_tag.value = ?
       )`
    : "";
  const bindings: unknown[] = [cursor.articleId, cursor.publishedAt];
  if (cursor.tag) bindings.push(cursor.tag);
  const anchor = await database
    .prepare(
      `${publicArticleSelection}
       WHERE article.trashed_at IS NULL
         AND article.id = ?
         AND article.published_at = ?
         ${tagPredicate}
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<PublicArticleRow>();
  return anchor !== null;
}

export async function listPublicArticles(
  database: D1Database,
  input: unknown = {},
): Promise<ListPublicArticlesResult> {
  const parsedQuery = publicArticleListQuery.safeParse(input);
  if (!parsedQuery.success) return { ok: false, reason: "invalid-query" };
  const normalizedTag = parsedQuery.data.tag
    ? normalizeArticleTag(parsedQuery.data.tag)
    : null;
  if (parsedQuery.data.tag !== undefined && normalizedTag === null) {
    return { ok: false, reason: "invalid-query" };
  }

  let cursor: PublicArticleListCursor | null = null;
  if (parsedQuery.data.cursor) {
    cursor = decodePublicArticleListCursor(parsedQuery.data.cursor);
    if (!cursor) return { ok: false, reason: "invalid-cursor" };
    if (
      cursor.tag !== normalizedTag ||
      !(await publicArticleListCursorIsCurrent(database, cursor))
    ) {
      return { ok: false, reason: "stale-cursor" };
    }
  }

  const predicates = ["article.trashed_at IS NULL"];
  const bindings: unknown[] = [];
  if (normalizedTag) {
    predicates.push(`EXISTS (
      SELECT 1 FROM json_each(publication.tags) AS publication_tag
      WHERE publication_tag.value = ?
    )`);
    bindings.push(normalizedTag);
  }
  if (cursor) {
    predicates.push(`(
      article.published_at < ? OR
      (article.published_at = ? AND article.id > ?)
    )`);
    bindings.push(cursor.publishedAt, cursor.publishedAt, cursor.articleId);
  }
  bindings.push(parsedQuery.data.limit + 1);
  const { results } = await database
    .prepare(
      `${publicArticleSelection}
       WHERE ${predicates.join(" AND ")}
       ORDER BY article.published_at DESC, article.id ASC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<PublicArticleRow>();
  const hasNextPage = results.length > parsedQuery.data.limit;
  const pageRows = results.slice(0, parsedQuery.data.limit);
  const lastRow = pageRows.at(-1);
  return {
    ok: true,
    page: {
      items: pageRows.map(publicArticleListItemFromRow),
      nextCursor:
        hasNextPage && lastRow
          ? encodePublicArticleListCursor({
              v: 1,
              publishedAt:
                persistedPublicArticle.parse(lastRow).article_published_at,
              articleId: lastRow.id,
              tag: normalizedTag,
            })
          : null,
    },
  };
}

export async function resolvePublicArticle(
  database: D1Database,
  slug: string,
): Promise<
  | { kind: "article"; article: PublicArticle; publicationId: string }
  | { kind: "redirect"; canonicalSlug: string }
  | { kind: "gone" }
  | null
> {
  const requestedSlugKey = articleSlugKey(slug);
  const row = await database
    .prepare(
      `${publicArticleSelection}
       JOIN article_slug ON article_slug.article_id = article.id
       WHERE article.trashed_at IS NULL
         AND article_slug.slug_key = ?
         AND article_slug.was_published = 1
       LIMIT 1`,
    )
    .bind(requestedSlugKey)
    .first<PublicArticleRow>();
  if (!row) {
    const tombstone = await database
      .prepare("SELECT 1 FROM purged_article_slug WHERE slug_key = ? LIMIT 1")
      .bind(requestedSlugKey)
      .first();
    return tombstone ? { kind: "gone" } : null;
  }
  const parsed = persistedPublicArticle.parse(row);
  if (slug !== parsed.slug) {
    return { kind: "redirect", canonicalSlug: parsed.slug };
  }
  return {
    kind: "article",
    article: publicArticleFromRow(row),
    publicationId: parsed.publication_id,
  };
}
