import { z } from "zod";

import type { PublicArticle, PublicArticleListItem } from "./articles";

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

export type PublicArticleProjectionRow = z.input<typeof persistedPublicArticle>;

export const publicArticleProjectionSelection = `
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

export function decodePublicArticleProjection(
  row: PublicArticleProjectionRow,
): { article: PublicArticle; publicationId: string } {
  const publication = persistedPublicArticle.parse(row);
  return {
    publicationId: publication.publication_id,
    article: {
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
    },
  };
}

export function publicArticleListItemFromProjection(
  row: PublicArticleProjectionRow,
): PublicArticleListItem {
  const { html: _html, ...item } = decodePublicArticleProjection(row).article;
  return item;
}

export async function confirmCurrentPublicArticle(
  database: D1Database,
  articleId: string,
  publicationId: string,
): Promise<PublicArticle | null> {
  const row = await database
    .prepare(
      `${publicArticleProjectionSelection}
       JOIN article_slug
         ON article_slug.article_id = article.id
        AND article_slug.slug_key = publication.slug_key
       WHERE article.trashed_at IS NULL
         AND article.id = ?
         AND publication.id = ?
         AND article_slug.was_published = 1
       LIMIT 1`,
    )
    .bind(articleId, publicationId)
    .first<PublicArticleProjectionRow>();
  if (!row) return null;
  const decoded = decodePublicArticleProjection(row);
  return decoded.publicationId === publicationId ? decoded.article : null;
}
