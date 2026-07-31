import { z } from "zod";

import type {
  ArticleRestoreTransition,
  ArticleTrashEntry,
  ArticleTrashTransition,
} from "./articles";

const persistedTrashTransition = z.object({
  id: z.string().uuid(),
  current_publication_id: z.null(),
  trashed_at: z.number().int().nonnegative(),
});

const persistedRestoreTransition = z.object({
  id: z.string().uuid(),
  current_publication_id: z.null(),
});

const persistedTrashEntry = persistedTrashTransition.extend({
  title: z.string(),
  slug: z.string().nullable(),
  draft_version: z.number().int().positive(),
  publication_count: z.number().int().nonnegative(),
});

export type TrashArticleResult =
  | { ok: true; article: ArticleTrashTransition }
  | { ok: false; reason: "not-found" };

export type RestoreTrashedArticleResult =
  | { ok: true; article: ArticleRestoreTransition }
  | { ok: false; reason: "not-found" };

function trashTransitionFromRow(
  input: z.input<typeof persistedTrashTransition>,
): ArticleTrashTransition {
  const row = persistedTrashTransition.parse(input);
  return {
    id: row.id,
    currentPublicationId: null,
    trashedAt: new Date(row.trashed_at).toISOString(),
  };
}

function trashEntryFromRow(
  input: z.input<typeof persistedTrashEntry>,
): ArticleTrashEntry {
  const row = persistedTrashEntry.parse(input);
  return {
    ...trashTransitionFromRow(row),
    title: row.title,
    slug: row.slug,
    draftVersion: row.draft_version,
    publicationCount: row.publication_count,
  };
}

export async function trashArticle(
  database: D1Database,
  articleId: string,
): Promise<TrashArticleResult> {
  const trashedAt = Date.now();
  const result = await database
    .prepare(
      `UPDATE article
       SET current_publication_id = NULL,
           trashed_at = ?
       WHERE id = ? AND trashed_at IS NULL
       RETURNING id, current_publication_id, trashed_at`,
    )
    .bind(trashedAt, articleId)
    .run<z.input<typeof persistedTrashTransition>>();
  const row = result.results.at(0);
  return row
    ? { ok: true, article: trashTransitionFromRow(row) }
    : { ok: false, reason: "not-found" };
}

export async function listTrashedArticles(
  database: D1Database,
): Promise<ArticleTrashEntry[]> {
  const { results } = await database
    .prepare(
      `SELECT article.id, article.current_publication_id, article.trashed_at,
              article_draft.title, article_draft.slug,
              article_draft.version AS draft_version,
              COUNT(publication.id) AS publication_count
       FROM article
       JOIN article_draft ON article_draft.article_id = article.id
       LEFT JOIN publication ON publication.article_id = article.id
       WHERE article.trashed_at IS NOT NULL
       GROUP BY article.id, article.current_publication_id, article.trashed_at,
                article_draft.title, article_draft.slug, article_draft.version
       ORDER BY article.trashed_at DESC, article.id ASC`,
    )
    .all<z.input<typeof persistedTrashEntry>>();
  return results.map(trashEntryFromRow);
}

export async function restoreTrashedArticle(
  database: D1Database,
  articleId: string,
): Promise<RestoreTrashedArticleResult> {
  const result = await database
    .prepare(
      `UPDATE article
       SET current_publication_id = NULL,
           trashed_at = NULL
       WHERE id = ? AND trashed_at IS NOT NULL
       RETURNING id, current_publication_id`,
    )
    .bind(articleId)
    .run<z.input<typeof persistedRestoreTransition>>();
  const row = result.results.at(0);
  if (!row) return { ok: false, reason: "not-found" };
  const restored = persistedRestoreTransition.parse(row);
  return {
    ok: true,
    article: { id: restored.id, currentPublicationId: null },
  };
}
