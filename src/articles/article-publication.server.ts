import { ZodError } from "zod";

import { readSiteSettings } from "../site-settings/site-settings.server";
import { resolveArticleMetadata } from "../site-settings/site-settings";
import type { PublicationIssue, RenderedArticleDraft } from "./articles";
import {
  NonCanonicalArticleDraftMetadataError,
  readArticleDraftForRendering,
} from "./articles.server";
import {
  renderPublication,
  type PublicationRendererDependencies,
} from "./publication-renderer.server";

export type RenderSavedArticleDraftResult =
  | { ok: true; renderedDraft: RenderedArticleDraft }
  | {
      ok: false;
      reason: "not-found" | "version-conflict" | "invalid";
      issues?: PublicationIssue[];
    };

function hasSubstantiveContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSubstantiveContent);
  if (value === null || typeof value !== "object") return false;

  const node = value as Record<string, unknown>;
  if (node.type === "figure" || node.type === "videoEmbed") return true;
  if (
    node.type === "text" &&
    typeof node.text === "string" &&
    node.text.trim().length > 0
  ) {
    return true;
  }
  return hasSubstantiveContent(node.content);
}

function publicationContextIssues(
  title: string,
  slug: string | null,
  document: { doc: unknown },
): PublicationIssue[] {
  const issues: PublicationIssue[] = [];
  if (title.length === 0) {
    issues.push({
      code: "TITLE_REQUIRED",
      path: "metadata.title",
      message: "A title is required",
    });
  }
  if (slug === null) {
    issues.push({
      code: "SLUG_REQUIRED",
      path: "metadata.slug",
      message: "A slug is required",
    });
  }
  if (!hasSubstantiveContent(document.doc)) {
    issues.push({
      code: "BODY_REQUIRED",
      path: "doc",
      message: "Substantive body content is required",
    });
  }
  return issues;
}

function invalidSavedDraftIssues(error: ZodError): PublicationIssue[] {
  const fields = new Set(
    error.issues.map((issue) => String(issue.path[0] ?? "draft")),
  );
  return [...fields].map((field) => {
    if (field === "document") {
      return {
        code: "INVALID_SAVED_DRAFT",
        path: "draft.document",
        message: "The saved Draft document envelope is invalid",
      };
    }
    const metadataField = [
      "title",
      "slug",
      "summary",
      "tags",
      "byline",
      "language",
    ].includes(field)
      ? field
      : "metadata";
    return {
      code: "INVALID_SAVED_DRAFT",
      path:
        metadataField === "metadata" ? "metadata" : `metadata.${metadataField}`,
      message: "The saved Draft metadata is invalid",
    };
  });
}

export async function renderSavedArticleDraft(
  database: D1Database,
  articleId: string,
  draftVersion: unknown,
  rendererDependencies: PublicationRendererDependencies,
): Promise<RenderSavedArticleDraftResult> {
  if (
    typeof draftVersion !== "number" ||
    !Number.isInteger(draftVersion) ||
    draftVersion < 1
  ) {
    return {
      ok: false,
      reason: "invalid",
      issues: [
        {
          code: "INVALID_DRAFT_VERSION",
          path: "version",
          message: "Draft Version must be a positive integer",
        },
      ],
    };
  }

  let article;
  try {
    article = await readArticleDraftForRendering(database, articleId);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        reason: "invalid",
        issues: invalidSavedDraftIssues(error),
      };
    }
    if (error instanceof NonCanonicalArticleDraftMetadataError) {
      return {
        ok: false,
        reason: "invalid",
        issues: [
          {
            code: "INVALID_SAVED_DRAFT",
            path: "metadata",
            message: "The saved Draft metadata is invalid",
          },
        ],
      };
    }
    throw error;
  }
  if (!article) return { ok: false, reason: "not-found" };
  if (article.draft.version !== draftVersion) {
    return { ok: false, reason: "version-conflict" };
  }

  let settings;
  try {
    settings = await readSiteSettings(database);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return {
      ok: false,
      reason: "invalid",
      issues: [
        {
          code: "INVALID_SITE_SETTINGS",
          path: "metadata",
          message: "Site Settings cannot resolve preview metadata",
        },
      ],
    };
  }
  const metadata = resolveArticleMetadata(settings, article.draft);
  const contextIssues = publicationContextIssues(
    article.draft.title,
    article.draft.slug,
    article.draft.document,
  );
  if (contextIssues.length > 0) {
    return { ok: false, reason: "invalid", issues: contextIssues };
  }
  const rendered = await renderPublication(
    article.draft.document,
    rendererDependencies,
    article.draft.cover,
  );
  if (!rendered.ok) {
    return { ok: false, reason: "invalid", issues: rendered.issues };
  }

  return {
    ok: true,
    renderedDraft: {
      articleId: article.id,
      draftVersion: article.draft.version,
      documentSchemaVersion: article.draft.document.documentSchemaVersion,
      metadata: {
        title: article.draft.title,
        slug: article.draft.slug,
        summary: article.draft.summary,
        tags: article.draft.tags,
        byline: metadata.byline,
        language: metadata.language,
      },
      rendererVersion: rendered.value.rendererVersion,
      coverHtml: rendered.value.coverHtml ?? null,
      html: rendered.value.html,
    },
  };
}
