import { z } from "zod";

import {
  BYLINE_NAME_MAXIMUM_LENGTH,
  BYLINE_URL_MAXIMUM_LENGTH,
  LANGUAGE_TAG_MAXIMUM_LENGTH,
  resolveArticleMetadata,
} from "../site-settings/site-settings";
import { readSiteSettings } from "../site-settings/site-settings.server";
import {
  articleDocumentAssetReferences,
  validateArticleDocument,
} from "./article-document";
import {
  normalizeArticleTag,
  readArticle,
  replaceArticleDraftState,
} from "./articles.server";
import {
  ARTICLE_ASSET_ALT_MAXIMUM_LENGTH,
  ARTICLE_DOCUMENT_SCHEMA_VERSION,
  ARTICLE_SUMMARY_MAXIMUM_LENGTH,
  ARTICLE_TAG_MAXIMUM_LENGTH,
  ARTICLE_TAGS_MAXIMUM_COUNT,
  ARTICLE_TITLE_MAXIMUM_LENGTH,
  type AdminArticleListItem,
  type Article,
  type ArticleCoverUsage,
  type ArticleDocument,
  type ArticleLifecycleProjection,
  type ArticlePublicationHistory,
} from "./articles";
import type { PublicationRestorationIssue } from "./publication-restoration";
import { articleSlugSchema } from "./article-slug";

const historyRow = z.object({
  id: z.string().uuid(),
  publication_number: z.number().int().positive(),
  title: z.string(),
  slug: z.string(),
  published_at: z.number().int().nonnegative(),
  is_current: z.number().int().min(0).max(1),
});

type HistoryRow = z.input<typeof historyRow>;

interface PublicationSourceRow {
  id: string;
  article_id: string;
  publication_number: number;
  title: string;
  slug: string;
  summary: string | null;
  tags: string;
  byline: string;
  language: string;
  cover: string | null;
  document_schema_version: number;
  document: string;
}

interface PublicationReferenceRow {
  asset_id: string;
  public_asset_id: string;
  asset_lifecycle_state: string;
}

interface PublicationSource {
  row: PublicationSourceRow;
  references: PublicationReferenceRow[];
}

interface RestorableDraft {
  title: string;
  slug: string;
  summary: string | null;
  tags: string[];
  byline: { name: string; url: string | null };
  language: string;
  cover: ArticleCoverUsage | null;
  document: ArticleDocument;
}

type PublicationConversionResult =
  | { ok: true; draft: RestorableDraft }
  | { ok: false; issues: PublicationRestorationIssue[] };

export type ListArticlePublicationHistoryResult =
  | { ok: true; history: ArticlePublicationHistory }
  | { ok: false; reason: "not-found" };

export type RestoreArticlePublicationResult =
  | { ok: true; article: Article }
  | { ok: false; reason: "invalid"; issues: PublicationRestorationIssue[] }
  | {
      ok: false;
      reason:
        | "conflict"
        | "confirmation-required"
        | "article-not-found"
        | "publication-not-found";
    };

const publicationTag = z
  .string()
  .min(1)
  .max(ARTICLE_TAG_MAXIMUM_LENGTH)
  .refine((value) => normalizeArticleTag(value) === value);

const publicationByline = z
  .object({
    name: z
      .string()
      .min(1)
      .max(BYLINE_NAME_MAXIMUM_LENGTH)
      .refine((value) => value.trim() === value),
    url: z
      .string()
      .max(BYLINE_URL_MAXIMUM_LENGTH)
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            url.toString() === value
          );
        } catch {
          return false;
        }
      })
      .nullable(),
  })
  .strict();

const publicationLanguage = z
  .string()
  .max(LANGUAGE_TAG_MAXIMUM_LENGTH)
  .refine((value) => {
    try {
      return Intl.getCanonicalLocales(value)[0] === value;
    } catch {
      return false;
    }
  });

const publicationMetadata = z
  .object({
    title: z
      .string()
      .min(1)
      .max(ARTICLE_TITLE_MAXIMUM_LENGTH)
      .refine((value) => value.trim() === value),
    slug: articleSlugSchema,
    summary: z.string().max(ARTICLE_SUMMARY_MAXIMUM_LENGTH).nullable(),
    tags: z.array(publicationTag).max(ARTICLE_TAGS_MAXIMUM_COUNT),
    byline: publicationByline,
    language: publicationLanguage,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.tags).size !== value.tags.length) {
      context.addIssue({
        code: "custom",
        path: ["tags"],
        message: "Publication tags must be unique",
      });
    }
  });

const publicationCover = z
  .object({
    url: z.string().url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    alt: z
      .string()
      .min(1)
      .max(ARTICLE_ASSET_ALT_MAXIMUM_LENGTH)
      .refine((value) => value.trim() === value),
  })
  .strict();

const publicationReference = z.object({
  asset_id: z.string().uuid(),
  public_asset_id: z.string().uuid(),
  asset_lifecycle_state: z.literal("ready"),
});

function restoreIssue(
  code: string,
  path: string,
  message: string,
): PublicationConversionResult {
  return { ok: false, issues: [{ code, path, message }] };
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function migratePublicationDocument(
  storedSchemaVersion: number,
  source: unknown,
):
  | { ok: true; document: ArticleDocument }
  | { ok: false; issues: PublicationRestorationIssue[] } {
  if (storedSchemaVersion !== ARTICLE_DOCUMENT_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_DOCUMENT_SCHEMA_VERSION",
          path: "document.documentSchemaVersion",
          message: `Publication Document Schema Version ${storedSchemaVersion} cannot be migrated safely`,
        },
      ],
    };
  }

  const envelopeVersion =
    source !== null &&
    typeof source === "object" &&
    "documentSchemaVersion" in source
      ? (source as { documentSchemaVersion?: unknown }).documentSchemaVersion
      : undefined;
  if (envelopeVersion !== storedSchemaVersion) {
    return {
      ok: false,
      issues: [
        {
          code: "DOCUMENT_SCHEMA_VERSION_MISMATCH",
          path: "document.documentSchemaVersion",
          message:
            "Publication source and stored Document Schema Version do not match",
        },
      ],
    };
  }

  const validated = validateArticleDocument(source);
  if (!validated.ok) {
    return {
      ok: false,
      issues: validated.issues.map((issue) => ({
        code: "PUBLICATION_DOCUMENT_INVALID",
        path: `document.${issue.path}`,
        message: "Publication source cannot be migrated safely",
      })),
    };
  }
  if (JSON.stringify(validated.document) !== JSON.stringify(source)) {
    return {
      ok: false,
      issues: [
        {
          code: "PUBLICATION_DOCUMENT_NON_CANONICAL",
          path: "document",
          message: "Publication source cannot be migrated safely",
        },
      ],
    };
  }
  return { ok: true, document: validated.document };
}

function sourceCoverUsage(
  input: unknown,
  references: z.output<typeof publicationReference>[],
):
  | { ok: true; cover: ArticleCoverUsage | null }
  | { ok: false; issues: PublicationRestorationIssue[] } {
  if (input === null) return { ok: true, cover: null };
  const cover = publicationCover.safeParse(input);
  if (!cover.success) {
    return {
      ok: false,
      issues: [
        {
          code: "PUBLICATION_COVER_INVALID",
          path: "cover",
          message: "Publication cover usage cannot be restored safely",
        },
      ],
    };
  }

  const url = new URL(cover.data.url);
  const path = url.pathname.split("/").filter(Boolean);
  const publicAssetId =
    path.length === 2 && path[0] === "media" ? path[1] : null;
  const matches = references.filter(
    (reference) => reference.public_asset_id === publicAssetId,
  );
  if (matches.length !== 1) {
    return {
      ok: false,
      issues: [
        {
          code: "PUBLICATION_COVER_ASSET_UNRESOLVED",
          path: "cover.url",
          message:
            "Publication cover cannot be matched to one retained Asset reference",
        },
      ],
    };
  }
  return {
    ok: true,
    cover: { assetId: matches[0].asset_id, alt: cover.data.alt },
  };
}

function convertPublicationSource(
  source: PublicationSource,
): PublicationConversionResult {
  const parsedTags = parseJson(source.row.tags);
  const parsedByline = parseJson(source.row.byline);
  const metadata = publicationMetadata.safeParse({
    title: source.row.title,
    slug: source.row.slug,
    summary: source.row.summary,
    tags: parsedTags,
    byline: parsedByline,
    language: source.row.language,
  });
  if (!metadata.success || metadata.data.slug !== source.row.slug) {
    return restoreIssue(
      "PUBLICATION_METADATA_INVALID",
      "metadata",
      "Publication metadata cannot be migrated safely",
    );
  }

  const parsedReferences = z
    .array(publicationReference)
    .safeParse(source.references);
  if (!parsedReferences.success) {
    return restoreIssue(
      "PUBLICATION_ASSET_REFERENCES_INVALID",
      "assets",
      "Publication Asset references cannot be restored safely",
    );
  }

  const sourceDocument = parseJson(source.row.document);
  if (sourceDocument === null) {
    return restoreIssue(
      "PUBLICATION_DOCUMENT_INVALID",
      "document",
      "Publication source cannot be migrated safely",
    );
  }
  const migrated = migratePublicationDocument(
    source.row.document_schema_version,
    sourceDocument,
  );
  if (!migrated.ok) return migrated;

  const rawCover =
    source.row.cover === null ? null : parseJson(source.row.cover);
  if (source.row.cover !== null && rawCover === null) {
    return restoreIssue(
      "PUBLICATION_COVER_INVALID",
      "cover",
      "Publication cover usage cannot be restored safely",
    );
  }
  const cover = sourceCoverUsage(rawCover, parsedReferences.data);
  if (!cover.ok) return cover;

  const usedAssetIds = new Set(
    articleDocumentAssetReferences(migrated.document).map(
      ({ assetId }) => assetId,
    ),
  );
  if (cover.cover) usedAssetIds.add(cover.cover.assetId);
  const retainedAssetIds = new Set(
    parsedReferences.data.map(({ asset_id }) => asset_id),
  );
  if (
    usedAssetIds.size !== retainedAssetIds.size ||
    [...usedAssetIds].some((assetId) => !retainedAssetIds.has(assetId))
  ) {
    return restoreIssue(
      "PUBLICATION_ASSET_REFERENCES_INCONSISTENT",
      "assets",
      "Publication source and retained Asset references do not match",
    );
  }

  return {
    ok: true,
    draft: {
      title: metadata.data.title,
      slug: metadata.data.slug,
      summary: metadata.data.summary,
      tags: metadata.data.tags,
      byline: metadata.data.byline,
      language: metadata.data.language,
      cover: cover.cover,
      document: migrated.document,
    },
  };
}

async function readPublicationSource(
  database: D1Database,
  articleId: string,
  publicationId?: string,
): Promise<PublicationSource | null> {
  const publicationPredicate = publicationId
    ? "AND publication.id = ?"
    : "ORDER BY publication.publication_number DESC, publication.id ASC LIMIT 1";
  const bindings = publicationId ? [articleId, publicationId] : [articleId];
  const row = await database
    .prepare(
      `SELECT publication.id, publication.article_id,
              publication.publication_number, publication.title,
              publication.slug, publication.summary, publication.tags,
              publication.byline, publication.language, publication.cover,
              publication.document_schema_version, publication.document
       FROM publication
       JOIN article ON article.id = publication.article_id
       WHERE article.id = ? AND article.trashed_at IS NULL
         ${publicationPredicate}`,
    )
    .bind(...bindings)
    .first<PublicationSourceRow>();
  if (!row) return null;
  const { results } = await database
    .prepare(
      `SELECT asset_id, public_asset_id, asset_lifecycle_state
       FROM publication_asset_reference
       WHERE publication_id = ?
       ORDER BY asset_id`,
    )
    .bind(row.id)
    .all<PublicationReferenceRow>();
  return { row, references: results };
}

function draftMatchesPublication(
  article: Article,
  restored: RestorableDraft,
  resolvedByline: { name: string; url: string | null },
  resolvedLanguage: string,
): boolean {
  return (
    JSON.stringify({
      title: article.draft.title,
      slug: article.draft.slug,
      summary: article.draft.summary,
      tags: article.draft.tags,
      byline: resolvedByline,
      language: resolvedLanguage,
      cover: article.draft.cover,
      document: article.draft.document,
    }) ===
    JSON.stringify({
      title: restored.title,
      slug: restored.slug,
      summary: restored.summary,
      tags: restored.tags,
      byline: restored.byline,
      language: restored.language,
      cover: restored.cover,
      document: restored.document,
    })
  );
}

async function articleHasUnpublishedChanges(
  database: D1Database,
  article: Article,
): Promise<boolean> {
  try {
    const source = article.currentPublicationId
      ? await readPublicationSource(
          database,
          article.id,
          article.currentPublicationId,
        )
      : await readPublicationSource(database, article.id);
    if (!source) return false;
    const converted = convertPublicationSource(source);
    if (!converted.ok) return true;
    const settings = await readSiteSettings(database);
    const metadata = resolveArticleMetadata(settings, article.draft);
    return !draftMatchesPublication(
      article,
      converted.draft,
      metadata.byline,
      metadata.language,
    );
  } catch {
    return true;
  }
}

function lifecycleProjectionForArticle(
  article: Article,
  publicationCount: number,
  divergesFromCurrent: boolean,
): ArticleLifecycleProjection {
  if (article.currentPublicationId === null) {
    return publicationCount === 0 ? "draft" : "unpublished";
  }
  return divergesFromCurrent ? "changes-pending" : "published";
}

/**
 * Derive the Articles workspace lifecycle projection for a list page in one
 * Site Settings read plus batched Publication lookups — never one history
 * request per row.
 */
export async function projectAdminArticles(
  database: D1Database,
  articles: Article[],
): Promise<AdminArticleListItem[]> {
  if (articles.length === 0) return [];

  const articleIds = articles.map((article) => article.id);
  const countPlaceholders = articleIds.map(() => "?").join(", ");
  const { results: countRows } = await database
    .prepare(
      `SELECT article_id AS articleId, COUNT(*) AS publicationCount
       FROM publication
       WHERE article_id IN (${countPlaceholders})
       GROUP BY article_id`,
    )
    .bind(...articleIds)
    .all<{ articleId: string; publicationCount: number }>();
  const publicationCountByArticleId = new Map(
    countRows.map((row) => [row.articleId, Number(row.publicationCount)]),
  );

  const currentPublicationIds = [
    ...new Set(
      articles
        .map((article) => article.currentPublicationId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const currentById = new Map<string, PublicationSource>();
  if (currentPublicationIds.length > 0) {
    const publicationPlaceholders = currentPublicationIds
      .map(() => "?")
      .join(", ");
    const { results: publicationRows } = await database
      .prepare(
        `SELECT publication.id, publication.article_id,
                publication.publication_number, publication.title,
                publication.slug, publication.summary, publication.tags,
                publication.byline, publication.language, publication.cover,
                publication.document_schema_version, publication.document
         FROM publication
         WHERE publication.id IN (${publicationPlaceholders})`,
      )
      .bind(...currentPublicationIds)
      .all<PublicationSourceRow>();
    const { results: referenceRows } = await database
      .prepare(
        `SELECT publication_id AS publicationId, asset_id, public_asset_id,
                asset_lifecycle_state
         FROM publication_asset_reference
         WHERE publication_id IN (${publicationPlaceholders})
         ORDER BY publication_id, asset_id`,
      )
      .bind(...currentPublicationIds)
      .all<PublicationReferenceRow & { publicationId: string }>();
    const referencesByPublicationId = new Map<
      string,
      PublicationReferenceRow[]
    >();
    for (const row of referenceRows) {
      const list = referencesByPublicationId.get(row.publicationId) ?? [];
      list.push({
        asset_id: row.asset_id,
        public_asset_id: row.public_asset_id,
        asset_lifecycle_state: row.asset_lifecycle_state,
      });
      referencesByPublicationId.set(row.publicationId, list);
    }
    for (const row of publicationRows) {
      currentById.set(row.id, {
        row,
        references: referencesByPublicationId.get(row.id) ?? [],
      });
    }
  }

  const settings = await readSiteSettings(database);

  return articles.map((article) => {
    const publicationCount = publicationCountByArticleId.get(article.id) ?? 0;
    let divergesFromCurrent = false;
    if (article.currentPublicationId !== null) {
      const source = currentById.get(article.currentPublicationId);
      if (!source) {
        divergesFromCurrent = true;
      } else {
        try {
          const converted = convertPublicationSource(source);
          if (!converted.ok) {
            divergesFromCurrent = true;
          } else {
            const metadata = resolveArticleMetadata(settings, article.draft);
            divergesFromCurrent = !draftMatchesPublication(
              article,
              converted.draft,
              metadata.byline,
              metadata.language,
            );
          }
        } catch {
          divergesFromCurrent = true;
        }
      }
    }
    return {
      ...article,
      lifecycleProjection: lifecycleProjectionForArticle(
        article,
        publicationCount,
        divergesFromCurrent,
      ),
    };
  });
}

export async function listArticlePublicationHistory(
  database: D1Database,
  articleId: string,
): Promise<ListArticlePublicationHistoryResult> {
  const article = await readArticle(database, articleId);
  if (!article) return { ok: false, reason: "not-found" };
  const { results } = await database
    .prepare(
      `SELECT publication.id, publication.publication_number,
              publication.title, publication.slug, publication.published_at,
              CASE WHEN publication.id = article.current_publication_id
                   THEN 1 ELSE 0 END AS is_current
       FROM publication
       JOIN article ON article.id = publication.article_id
       WHERE article.id = ? AND article.trashed_at IS NULL
       ORDER BY publication.publication_number DESC, publication.id ASC`,
    )
    .bind(articleId)
    .all<HistoryRow>();
  const publications = results.map((input) => {
    const row = historyRow.parse(input);
    return {
      id: row.id,
      publicationNumber: row.publication_number,
      title: row.title,
      slug: row.slug,
      publishedAt: new Date(row.published_at).toISOString(),
      isCurrent: row.is_current === 1,
    };
  });
  return {
    ok: true,
    history: {
      publications,
      hasUnpublishedChanges:
        publications.length > 0
          ? await articleHasUnpublishedChanges(database, article)
          : false,
    },
  };
}

export async function restoreArticlePublication(
  database: D1Database,
  articleId: string,
  publicationId: string,
  draftVersion: number,
  confirmDiscardUnpublishedChanges: boolean,
): Promise<RestoreArticlePublicationResult> {
  const article = await readArticle(database, articleId);
  if (!article) return { ok: false, reason: "article-not-found" };
  if (article.draft.version !== draftVersion) {
    return { ok: false, reason: "conflict" };
  }

  const source = await readPublicationSource(
    database,
    articleId,
    publicationId,
  );
  if (!source) return { ok: false, reason: "publication-not-found" };
  const converted = convertPublicationSource(source);
  if (!converted.ok) {
    return { ok: false, reason: "invalid", issues: converted.issues };
  }
  if (
    (await articleHasUnpublishedChanges(database, article)) &&
    !confirmDiscardUnpublishedChanges
  ) {
    return { ok: false, reason: "confirmation-required" };
  }

  const restored = converted.draft;
  const { updated, article: articleAfterRestore } =
    await replaceArticleDraftState(
      database,
      article,
      {
        version: draftVersion,
        title: restored.title,
        slug: restored.slug,
        summary: restored.summary,
        tags: restored.tags,
        byline: restored.byline,
        language: restored.language,
        cover: restored.cover,
        document: restored.document,
      },
      { updateArticleTimestamp: false },
    );
  if (!updated) {
    return articleAfterRestore
      ? { ok: false, reason: "conflict" }
      : { ok: false, reason: "article-not-found" };
  }

  if (!articleAfterRestore) {
    throw new Error("Restored Article could not be read");
  }
  return { ok: true, article: articleAfterRestore };
}
