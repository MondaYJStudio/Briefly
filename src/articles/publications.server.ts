import { z } from "zod";

import { normalizeArticleTag } from "./articles.server";
import type { PublicArticle, PublicArticleListItem } from "./articles";
import { articleSlugKey } from "./article-slug";
import {
  decodePublicArticleProjection,
  publicArticleListItemFromProjection,
  publicArticleProjectionSelection,
  type PublicArticleProjectionRow,
} from "./public-article-projection.server";

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
      `${publicArticleProjectionSelection}
       WHERE article.trashed_at IS NULL
         AND article.id = ?
         AND article.published_at = ?
         ${tagPredicate}
       LIMIT 1`,
    )
    .bind(...bindings)
    .first<PublicArticleProjectionRow>();
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
      `${publicArticleProjectionSelection}
       WHERE ${predicates.join(" AND ")}
       ORDER BY article.published_at DESC, article.id ASC
       LIMIT ?`,
    )
    .bind(...bindings)
    .all<PublicArticleProjectionRow>();
  const hasNextPage = results.length > parsedQuery.data.limit;
  const pageRows = results.slice(0, parsedQuery.data.limit);
  const lastRow = pageRows.at(-1);
  return {
    ok: true,
    page: {
      items: pageRows.map(publicArticleListItemFromProjection),
      nextCursor:
        hasNextPage && lastRow
          ? encodePublicArticleListCursor({
              v: 1,
              publishedAt: lastRow.article_published_at,
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
      `${publicArticleProjectionSelection}
       JOIN article_slug ON article_slug.article_id = article.id
       WHERE article.trashed_at IS NULL
         AND article_slug.slug_key = ?
         AND article_slug.was_published = 1
       LIMIT 1`,
    )
    .bind(requestedSlugKey)
    .first<PublicArticleProjectionRow>();
  if (!row) {
    const tombstone = await database
      .prepare("SELECT 1 FROM purged_article_slug WHERE slug_key = ? LIMIT 1")
      .bind(requestedSlugKey)
      .first();
    return tombstone ? { kind: "gone" } : null;
  }
  const parsed = decodePublicArticleProjection(row);
  if (slug !== parsed.article.slug) {
    return { kind: "redirect", canonicalSlug: parsed.article.slug };
  }
  return {
    kind: "article",
    article: parsed.article,
    publicationId: parsed.publicationId,
  };
}
