import { z } from "zod";

import { readSiteSettings } from "../site-settings/site-settings.server";
import type { Article } from "./articles";
import {
  articleContentLanguage,
  listTranslationGroupMembers,
  listUngroupedArticles,
  readArticle,
  type ArticleValidationIssue,
} from "./articles.server";
import { projectAdminArticles } from "./publication-history.server";
import {
  translationLanguageKey,
  type ArticleTranslation,
} from "./translation-groups";

/** Membership facts for one non-trashed Article. */
interface MembershipState {
  translationGroupId: string | null;
  currentPublicationId: string | null;
  /** Translation language key of the Current Publication, if any. */
  publicLanguageKey: string | null;
}

const persistedMembershipState = z.object({
  id: z.string().uuid(),
  translation_group_id: z.string().uuid().nullable(),
  current_publication_id: z.string().uuid().nullable(),
  current_language: z.string().nullable(),
});

async function readMembershipStates(
  database: D1Database,
  articleIds: string[],
): Promise<Map<string, MembershipState>> {
  const { results } = await database
    .prepare(
      `SELECT article.id, article.translation_group_id,
              article.current_publication_id,
              publication.language AS current_language
       FROM article
       LEFT JOIN publication
         ON publication.id = article.current_publication_id
        AND publication.article_id = article.id
       WHERE article.trashed_at IS NULL
         AND article.id IN (${articleIds.map(() => "?").join(", ")})`,
    )
    .bind(...articleIds)
    .all();
  return new Map(
    results.map((input) => {
      const row = persistedMembershipState.parse(input);
      return [
        row.id,
        {
          translationGroupId: row.translation_group_id,
          currentPublicationId: row.current_publication_id,
          publicLanguageKey:
            row.current_publication_id === null || row.current_language === null
              ? null
              : translationLanguageKey(row.current_language),
        },
      ];
    }),
  );
}

/**
 * Clears the membership of a group's last remaining Article, so a group only
 * exists while it relates at least two Articles. Trashed members still count:
 * restoring one returns it to its group.
 */
export function dissolveLoneTranslationGroup(
  database: D1Database,
  translationGroupId: string,
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE article
       SET translation_group_id = NULL
       WHERE translation_group_id = ?
         AND (
           SELECT COUNT(*) FROM article AS member
           WHERE member.translation_group_id = ?
         ) < 2`,
    )
    .bind(translationGroupId, translationGroupId);
}

/**
 * Puts an ungrouped Article into a group and records the language key of its
 * Current Publication, guarded on the state the caller read.
 */
function joinTranslationGroup(
  database: D1Database,
  articleId: string,
  state: MembershipState,
  translationGroupId: string,
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE article
       SET translation_group_id = ?,
           current_publication_language_key =
             COALESCE(?, current_publication_language_key)
       WHERE id = ?
         AND translation_group_id IS NULL
         AND trashed_at IS NULL
         AND current_publication_id IS ?`,
    )
    .bind(
      translationGroupId,
      state.publicLanguageKey,
      articleId,
      state.currentPublicationId,
    );
}

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

function compareTranslations(
  left: ArticleTranslation,
  right: ArticleTranslation,
): number {
  if (left.language !== right.language)
    return left.language < right.language ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

async function projectTranslations(
  database: D1Database,
  members: Article[],
): Promise<ArticleTranslation[]> {
  if (members.length === 0) return [];
  const [projected, settings] = await Promise.all([
    projectAdminArticles(database, members),
    readSiteSettings(database),
  ]);
  return projected.map((member) => ({
    id: member.id,
    title: member.draft.title,
    language: member.draft.language ?? settings.defaultLanguage,
    lifecycleProjection: member.lifecycleProjection,
  }));
}

export type ListArticleTranslationsResult =
  | { ok: true; translations: ArticleTranslation[] }
  | { ok: false; reason: "not-found" };

/** The other non-trashed members of the Article's Translation Group. */
export async function listArticleTranslations(
  database: D1Database,
  articleId: string,
): Promise<ListArticleTranslationsResult> {
  const article = await readArticle(database, articleId);
  if (!article) return { ok: false, reason: "not-found" };
  const members = await listTranslationGroupMembers(database, articleId);
  return {
    ok: true,
    translations: (await projectTranslations(database, members)).sort(
      compareTranslations,
    ),
  };
}

/**
 * The Articles that could join this Article's group: every other non-trashed
 * Article outside all groups, most recently updated first. Linking still
 * refuses one whose public language is already public in the group.
 */
export async function listTranslationCandidates(
  database: D1Database,
  articleId: string,
): Promise<ListArticleTranslationsResult> {
  const article = await readArticle(database, articleId);
  if (!article) return { ok: false, reason: "not-found" };
  const candidates = await listUngroupedArticles(database, articleId);
  return {
    ok: true,
    translations: await projectTranslations(database, candidates),
  };
}

export type LinkArticleTranslationResult =
  | { ok: true; translations: ArticleTranslation[] }
  | {
      ok: false;
      reason:
        | "not-found"
        | "translation-not-found"
        | "self"
        | "already-linked"
        | "language-taken"
        | "conflict";
    };

type LinkRefusal = Extract<LinkArticleTranslationResult, { ok: false }>;

interface LinkPlan {
  groupId: string;
  anchor: MembershipState;
  joining: MembershipState;
}

async function planLink(
  database: D1Database,
  articleId: string,
  translationArticleId: string,
): Promise<LinkPlan | LinkRefusal> {
  const states = await readMembershipStates(database, [
    articleId,
    translationArticleId,
  ]);
  const anchor = states.get(articleId);
  if (!anchor) return { ok: false, reason: "not-found" };
  const joining = states.get(translationArticleId);
  if (!joining) return { ok: false, reason: "translation-not-found" };
  if (joining.translationGroupId !== null) {
    return { ok: false, reason: "already-linked" };
  }
  const key = joining.publicLanguageKey;
  if (key !== null) {
    const taken =
      anchor.translationGroupId === null
        ? anchor.publicLanguageKey === key
        : (await database
            .prepare(
              `SELECT 1 AS taken FROM article
               WHERE translation_group_id = ?
                 AND current_publication_id IS NOT NULL
                 AND current_publication_language_key = ?
               LIMIT 1`,
            )
            .bind(anchor.translationGroupId, key)
            .first()) !== null;
    if (taken) return { ok: false, reason: "language-taken" };
  }
  return {
    groupId: anchor.translationGroupId ?? crypto.randomUUID(),
    anchor,
    joining,
  };
}

/**
 * Joins one ungrouped Article into another Article's Translation Group,
 * creating the group when the other Article has none. Membership changes
 * public responses immediately, so an Article whose public language is
 * already public in the group is refused.
 */
export async function linkArticleTranslation(
  database: D1Database,
  articleId: string,
  translationArticleId: string,
): Promise<LinkArticleTranslationResult> {
  if (articleId === translationArticleId) return { ok: false, reason: "self" };
  const plan = await planLink(database, articleId, translationArticleId);
  if ("ok" in plan) return plan;
  const { groupId, anchor, joining } = plan;

  const statements: D1PreparedStatement[] = [];
  if (anchor.translationGroupId === null) {
    statements.push(joinTranslationGroup(database, articleId, anchor, groupId));
  }
  const joinIndex = statements.length;
  statements.push(
    database
      .prepare(
        `UPDATE article
         SET translation_group_id = ?,
             current_publication_language_key =
               COALESCE(?, current_publication_language_key)
         WHERE id = ?
           AND translation_group_id IS NULL
           AND trashed_at IS NULL
           AND current_publication_id IS ?
           AND EXISTS (
             SELECT 1 FROM article AS anchor
             WHERE anchor.id = ?
               AND anchor.translation_group_id = ?
               AND anchor.trashed_at IS NULL
           )
           AND (
             ? IS NULL OR NOT EXISTS (
               SELECT 1 FROM article AS member
               WHERE member.translation_group_id = ?
                 AND member.id <> ?
                 AND member.current_publication_id IS NOT NULL
                 AND member.current_publication_language_key = ?
             )
           )`,
      )
      .bind(
        groupId,
        joining.publicLanguageKey,
        translationArticleId,
        joining.currentPublicationId,
        articleId,
        groupId,
        joining.publicLanguageKey,
        groupId,
        translationArticleId,
        joining.publicLanguageKey,
      ),
  );
  // A group created above must not outlive a refused join.
  statements.push(dissolveLoneTranslationGroup(database, groupId));
  const batch = await database.batch(statements);

  if (changes(batch[joinIndex]) !== 1) {
    // The state changed after planning; report the reason it now has.
    const replanned = await planLink(database, articleId, translationArticleId);
    return "ok" in replanned ? replanned : { ok: false, reason: "conflict" };
  }
  const listed = await listArticleTranslations(database, articleId);
  return listed.ok
    ? { ok: true, translations: listed.translations }
    : { ok: false, reason: "conflict" };
}

export type UnlinkArticleTranslationResult =
  { ok: true } | { ok: false; reason: "not-found" };

/** Removes the Article from its Translation Group; unlinking twice is a no-op. */
export async function unlinkArticleTranslation(
  database: D1Database,
  articleId: string,
): Promise<UnlinkArticleTranslationResult> {
  const state = (await readMembershipStates(database, [articleId])).get(
    articleId,
  );
  if (!state) return { ok: false, reason: "not-found" };
  if (state.translationGroupId === null) return { ok: true };
  await database.batch([
    database
      .prepare(
        `UPDATE article
         SET translation_group_id = NULL
         WHERE id = ? AND translation_group_id = ? AND trashed_at IS NULL`,
      )
      .bind(articleId, state.translationGroupId),
    dissolveLoneTranslationGroup(database, state.translationGroupId),
  ]);
  return { ok: true };
}

const createTranslationInput = z
  .object({ language: articleContentLanguage })
  .strict();

export type CreateArticleTranslationResult =
  | { ok: true; article: Article }
  | { ok: false; reason: "invalid"; issues: ArticleValidationIssue[] }
  | { ok: false; reason: "not-found" | "language-taken" | "conflict" };

/**
 * Starts a translation: a new Article in the source Article's group whose
 * Draft copies the source Draft in the target language. Its slug starts empty
 * and follows the title, so the copy never claims the source's slug.
 */
export async function createArticleTranslation(
  database: D1Database,
  articleId: string,
  input: unknown,
): Promise<CreateArticleTranslationResult> {
  const parsed = createTranslationInput.safeParse(input);
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
  const language = parsed.data.language;

  const [source, states, members, settings] = await Promise.all([
    readArticle(database, articleId),
    readMembershipStates(database, [articleId]),
    listTranslationGroupMembers(database, articleId),
    readSiteSettings(database),
  ]);
  const state = states.get(articleId);
  if (!source || !state) return { ok: false, reason: "not-found" };
  const targetKey = translationLanguageKey(language);
  const taken = [source, ...members].some(
    (member) =>
      translationLanguageKey(
        member.draft.language ?? settings.defaultLanguage,
      ) === targetKey,
  );
  if (taken) return { ok: false, reason: "language-taken" };

  const groupId = state.translationGroupId ?? crypto.randomUUID();
  const translationId = crypto.randomUUID();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  if (state.translationGroupId === null) {
    statements.push(joinTranslationGroup(database, articleId, state, groupId));
  }
  const createIndex = statements.length;
  statements.push(
    database
      .prepare(
        `INSERT INTO article (id, translation_group_id, created_at, updated_at)
         SELECT ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM article
           WHERE id = ? AND translation_group_id = ? AND trashed_at IS NULL
         )`,
      )
      .bind(translationId, groupId, now, now, articleId, groupId),
    database
      .prepare(
        `INSERT INTO article_draft
           (article_id, version, title, slug, slug_key, slug_is_manual, summary,
            tags, byline, language, channel_slug, cover, document, created_at,
            updated_at)
         SELECT ?, 1, title, NULL, NULL, 0, summary, tags, byline, ?,
                channel_slug, cover, document, ?, ?
         FROM article_draft
         WHERE article_id = ?
           AND EXISTS (SELECT 1 FROM article WHERE id = ?)`,
      )
      .bind(translationId, language, now, now, articleId, translationId),
    database
      .prepare(
        `INSERT INTO article_draft_asset_reference (article_id, asset_id)
         SELECT ?, asset_id
         FROM article_draft_asset_reference
         WHERE article_id = ?
           AND EXISTS (SELECT 1 FROM article_draft WHERE article_id = ?)`,
      )
      .bind(translationId, articleId, translationId),
    // A group created above must not outlive a refused copy.
    dissolveLoneTranslationGroup(database, groupId),
  );
  const batch = await database.batch(statements);

  if (changes(batch[createIndex]) !== 1) {
    return (await readArticle(database, articleId))
      ? { ok: false, reason: "conflict" }
      : { ok: false, reason: "not-found" };
  }
  const created = await readArticle(database, translationId);
  if (!created) throw new Error("Created translation could not be read");
  return { ok: true, article: created };
}
