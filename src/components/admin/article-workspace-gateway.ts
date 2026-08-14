import { getApiClient } from "../../routes/api.$";
import type { ArticleDraftUpdate } from "../../articles/articles";
import type {
  ArticleDraftIssue,
  ArticleWorkspaceGateway,
  ArticleWorkspaceGatewayOutcome,
  PublicArticleAvailability,
} from "../../articles/article-workspace";
import { publicationReceiptConfirmation } from "../../articles/article-workspace";
import {
  isPublicationIssue,
  type PublicationIssue,
} from "../../articles/publication-workflow";
import {
  isPublicationRestorationIssue,
  type PublicationRestorationIssue,
} from "../../articles/publication-restoration";

type ApiClient = ReturnType<typeof getApiClient>;

/** The small response shape the adapter reads from Eden. */
interface ApiResponse<Value = unknown> {
  status: number;
  data?: Value;
  error?: { value?: unknown };
  response?: Response;
}

function apiResponse<Value>(value: unknown): ApiResponse<Value> {
  return value as ApiResponse<Value>;
}

function errorCode(response: ApiResponse): string | null {
  const value = response.error?.value;
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : null;
}

function errorIssues(response: ApiResponse): unknown[] {
  const value = response.error?.value;
  return typeof value === "object" &&
    value !== null &&
    "issues" in value &&
    Array.isArray(value.issues)
    ? value.issues
    : [];
}

function hasErrorIssues(response: ApiResponse): boolean {
  const value = response.error?.value;
  return (
    typeof value === "object" &&
    value !== null &&
    "issues" in value &&
    Array.isArray(value.issues)
  );
}

function draftIssues(response: ApiResponse): ArticleDraftIssue[] {
  return errorIssues(response).flatMap((issue) =>
    typeof issue === "object" &&
    issue !== null &&
    "message" in issue &&
    typeof issue.message === "string"
      ? [{ message: issue.message }]
      : [],
  );
}

function success<Value>(
  value: Value,
): Extract<ArticleWorkspaceGatewayOutcome<Value>, { ok: true }> {
  return { ok: true, value };
}

function failure<Value = never, Issue = never>(
  reason: Extract<
    ArticleWorkspaceGatewayOutcome<Value, Issue>,
    { ok: false }
  >["reason"],
  issues?: readonly Issue[],
): Extract<ArticleWorkspaceGatewayOutcome<Value, Issue>, { ok: false }> {
  return issues === undefined
    ? { ok: false, reason }
    : { ok: false, reason, issues };
}

function expectedData<Value>(
  response: ApiResponse<Value>,
  status: number,
): ArticleWorkspaceGatewayOutcome<Value> {
  if (
    response.status === status &&
    response.data !== undefined &&
    response.data !== null
  ) {
    return success(response.data);
  }
  if (!response.response) return failure("transport-error");
  if (response.status === 404) return failure("not-found");
  return failure("error");
}

function expectedStatus(
  response: ApiResponse,
  status: number,
): ArticleWorkspaceGatewayOutcome<void> {
  if (response.status === status && response.data) return success(undefined);
  if (!response.response) return failure("transport-error");
  if (response.status === 404) return failure("not-found");
  return failure("error");
}

/**
 * Eden adapter for the Article workspace. No React state or Eden route path
 * crosses the seam into the workspace hook.
 */
export function createArticleWorkspaceGateway(
  client: ApiClient = getApiClient(),
  fetcher: typeof fetch = globalThis.fetch,
): ArticleWorkspaceGateway {
  return {
    async listArticles() {
      try {
        const response = apiResponse<{
          articles: import("../../articles/articles").AdminArticleListItem[];
        }>(await client.admin.articles.get());
        const result = expectedData(response, 200);
        return result.ok && Array.isArray(result.value.articles)
          ? success(result.value.articles)
          : result.ok
            ? failure("error")
            : result;
      } catch {
        return failure("transport-error");
      }
    },

    async listTrashedArticles() {
      try {
        const response = apiResponse<{
          articles: import("../../articles/articles").ArticleTrashEntry[];
        }>(await client.admin.trash.articles.get());
        const result = expectedData(response, 200);
        return result.ok && Array.isArray(result.value.articles)
          ? success(result.value.articles)
          : result.ok
            ? failure("error")
            : result;
      } catch {
        return failure("transport-error");
      }
    },

    async createArticle() {
      try {
        const response = apiResponse<import("../../articles/articles").Article>(
          await client.admin.articles.post(),
        );
        return expectedData(response, 201);
      } catch {
        return failure("transport-error");
      }
    },

    async readArticle(articleId) {
      try {
        const response = apiResponse<import("../../articles/articles").Article>(
          await client.admin.articles({ articleId }).get(),
        );
        return expectedData(response, 200);
      } catch {
        return failure("transport-error");
      }
    },

    async saveDraft(articleId, draft: ArticleDraftUpdate) {
      try {
        const response = apiResponse<import("../../articles/articles").Article>(
          await client.admin.articles({ articleId }).draft.put(draft),
        );
        if (
          response.status === 200 &&
          response.data !== undefined &&
          response.data !== null
        )
          return success(response.data);
        if (!response.response) return failure("transport-error");
        if (response.status === 404) return failure("not-found");
        if (response.status === 409) {
          return errorCode(response) === "ARTICLE_SLUG_CONFLICT"
            ? failure("slug-conflict")
            : failure("conflict");
        }
        if (hasErrorIssues(response))
          return failure<never, ArticleDraftIssue>(
            "invalid",
            draftIssues(response),
          );
        return failure("error");
      } catch {
        return failure("transport-error");
      }
    },

    async previewDraft(articleId, draftVersion) {
      try {
        const response = apiResponse<
          import("../../articles/publication-workflow").PublicationPreview
        >(
          await client.admin
            .articles({ articleId })
            .preview.post({ draftVersion }),
        );
        if (
          response.status === 200 &&
          response.data !== undefined &&
          response.data !== null
        )
          return success(response.data);
        if (!response.response) return failure("transport-error");
        if (response.status === 404) return failure("not-found");
        if (response.status === 409) return failure("conflict");
        const issues = errorIssues(response).filter(isPublicationIssue);
        return hasErrorIssues(response)
          ? failure<never, PublicationIssue>("invalid", issues)
          : failure<never, PublicationIssue>("error");
      } catch {
        return failure("transport-error");
      }
    },

    async publishDraft({
      articleId,
      draftVersion,
      expectedCurrentPublicationId,
    }) {
      try {
        const response = apiResponse<unknown>(
          await client.admin.articles({ articleId }).publications.post({
            draftVersion,
            expectedCurrentPublicationId,
          }),
        );
        if (response.status === 201) {
          const receipt = publicationReceiptConfirmation(
            response.data,
            articleId,
          );
          return receipt && receipt.draftVersion === draftVersion
            ? success(receipt)
            : failure("state-unconfirmed");
        }
        if (!response.response) return failure("transport-error");
        if (response.status === 404) return failure("not-found");
        const code = errorCode(response);
        if (code === "PUBLICATION_CONFLICT") return failure("conflict");
        if (code === "PUBLICATION_INVALID") {
          const issues = errorIssues(response).filter(isPublicationIssue);
          return failure<never, PublicationIssue>("invalid", issues);
        }
        if (code === "PUBLICATION_NOT_COMPLETED")
          return failure("not-completed");
        if (code === "PUBLICATION_STATE_UNCONFIRMED")
          return failure("state-unconfirmed");
        return failure("error");
      } catch {
        return failure("transport-error");
      }
    },

    async unpublishArticle(articleId) {
      try {
        const response = apiResponse(
          await client.admin
            .articles({ articleId })
            ["current-publication"].delete(),
        );
        return expectedStatus(response, 200);
      } catch {
        return failure("transport-error");
      }
    },

    async readPublicationHistory(articleId) {
      try {
        const response = apiResponse<
          import("../../articles/articles").ArticlePublicationHistory
        >(await client.admin.articles({ articleId }).publications.get());
        return expectedData(response, 200);
      } catch {
        return failure("transport-error");
      }
    },

    async restorePublication({ articleId, publicationId, draftVersion }) {
      try {
        const response = apiResponse<import("../../articles/articles").Article>(
          await client.admin
            .articles({ articleId })
            .publications({ publicationId })
            .restore.post({
              draftVersion,
              confirmDiscardUnpublishedChanges: true,
            }),
        );
        if (
          response.status === 200 &&
          response.data !== undefined &&
          response.data !== null
        )
          return success(response.data);
        if (!response.response) return failure("transport-error");
        if (response.status === 404) return failure("not-found");
        if (response.status === 400) {
          const issues = errorIssues(response).filter(
            isPublicationRestorationIssue,
          );
          return failure<never, PublicationRestorationIssue>("invalid", issues);
        }
        if (response.status === 409) return failure("conflict");
        return failure("error");
      } catch {
        return failure("transport-error");
      }
    },

    async trashArticle(articleId) {
      try {
        const response = apiResponse(
          await client.admin.articles({ articleId }).trash.post(),
        );
        return expectedStatus(response, 200);
      } catch {
        return failure("transport-error");
      }
    },

    async restoreTrashedArticle(articleId) {
      try {
        const response = apiResponse(
          await client.admin.trash.articles({ articleId }).restore.post(),
        );
        return expectedStatus(response, 200);
      } catch {
        return failure("transport-error");
      }
    },

    async purgeTrashedArticle(articleId, confirmationTitle) {
      try {
        const response = apiResponse(
          await client.admin.trash
            .articles({ articleId })
            .delete({ confirmationTitle }),
        );
        return expectedStatus(response, 200);
      } catch {
        return failure("transport-error");
      }
    },

    async readPublicArticle(slug) {
      try {
        const response = await fetcher(
          `/api/articles/${encodeURIComponent(slug)}`,
          {
            cache: "no-store",
            headers: { accept: "application/json" },
          },
        );
        const availability: PublicArticleAvailability =
          response.status === 200
            ? "present"
            : response.status === 404 || response.status === 410
              ? "absent"
              : "unknown";
        return success({ availability });
      } catch {
        return failure("transport-error");
      }
    },
  };
}
