import type { Article } from "./articles";
import type { ArticleTranslation } from "./translation-groups";
import { getApiClient } from "../routes/api.$";

type ApiResponse<Value = unknown> = {
  status: number;
  data?: Value;
  error?: { value?: unknown } | null;
};

function errorCode(response: ApiResponse): string | null {
  const value = response.error?.value;
  if (typeof value !== "object" || value === null) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * The other members of the Article's Translation Group. Returns null when the
 * request fails so the caller can offer a retry.
 */
export async function listAdminArticleTranslations(
  articleId: string,
): Promise<ArticleTranslation[] | null> {
  try {
    const response = (await getApiClient()
      .admin.articles({ articleId })
      .translations.get()) as ApiResponse<{
      translations: ArticleTranslation[];
    }>;
    if (response.status !== 200 || !response.data) return null;
    return response.data.translations;
  } catch {
    return null;
  }
}

/** Articles outside every Translation Group that could join this one's. */
export async function listAdminTranslationCandidates(
  articleId: string,
): Promise<ArticleTranslation[] | null> {
  try {
    const response = (await getApiClient()
      .admin.articles({ articleId })
      ["translation-candidates"].get()) as ApiResponse<{
      candidates: ArticleTranslation[];
    }>;
    if (response.status !== 200 || !response.data) return null;
    return response.data.candidates;
  } catch {
    return null;
  }
}

export type LinkAdminArticleTranslationResult =
  | { ok: true; translations: ArticleTranslation[] }
  | {
      ok: false;
      reason: "already-linked" | "language-taken" | "not-found" | "error";
    };

export async function linkAdminArticleTranslation(
  articleId: string,
  translationArticleId: string,
): Promise<LinkAdminArticleTranslationResult> {
  try {
    const response = (await getApiClient()
      .admin.articles({ articleId })
      .translations({ translationArticleId })
      .put()) as ApiResponse<{ translations: ArticleTranslation[] }>;
    if (response.status === 200 && response.data) {
      return { ok: true, translations: response.data.translations };
    }
    if (response.status === 404) return { ok: false, reason: "not-found" };
    switch (errorCode(response)) {
      case "TRANSLATION_ALREADY_LINKED":
        return { ok: false, reason: "already-linked" };
      case "TRANSLATION_LANGUAGE_TAKEN":
        return { ok: false, reason: "language-taken" };
      default:
        return { ok: false, reason: "error" };
    }
  } catch {
    return { ok: false, reason: "error" };
  }
}

export type CreateAdminArticleTranslationResult =
  | { ok: true; article: Article }
  | { ok: false; reason: "language-taken" | "not-found" | "error" };

export async function createAdminArticleTranslation(
  articleId: string,
  language: string,
): Promise<CreateAdminArticleTranslationResult> {
  try {
    const response = (await getApiClient()
      .admin.articles({ articleId })
      .translations.post({ language })) as ApiResponse<Article>;
    if (response.status === 201 && response.data) {
      return { ok: true, article: response.data };
    }
    if (response.status === 404) return { ok: false, reason: "not-found" };
    return errorCode(response) === "TRANSLATION_LANGUAGE_TAKEN"
      ? { ok: false, reason: "language-taken" }
      : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Removes the Article from its Translation Group. */
export async function unlinkAdminArticleTranslation(
  articleId: string,
): Promise<boolean> {
  try {
    const response = (await getApiClient()
      .admin.articles({ articleId })
      ["translation-group"].delete()) as ApiResponse;
    return response.status === 204;
  } catch {
    return false;
  }
}
