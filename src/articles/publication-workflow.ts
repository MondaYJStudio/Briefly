import type { Byline } from "../site-settings/site-settings";
import type { PublicArticle } from "./articles";

/**
 * Stable Publication Issue codes. Specific codes are preferred for client
 * localization; the five coarse codes remain accepted for older fixtures and
 * deliberate UI mocks.
 */
export const PUBLICATION_ISSUE_CODES = [
  "REQUIRED",
  "INVALID",
  "UNSUPPORTED",
  "UNSAFE",
  "UNAVAILABLE",
  "TITLE_REQUIRED",
  "SLUG_REQUIRED",
  "BODY_REQUIRED",
  "BYLINE_INVALID",
  "LANGUAGE_INVALID",
  "CHANNEL_NOT_FOUND",
  "PERSISTED_FIELD_INVALID",
  "ASSET_NOT_RESOLVED",
  "FIGURE_ALT_REQUIRED",
  "INVALID_ASSET_IDENTITY",
  "INVALID_ASSET_RESOLUTION",
  "INVALID_COVER",
  "INVALID_DOCUMENT",
  "INVALID_DOCUMENT_STRUCTURE",
  "INVALID_HEADING_LEVEL",
  "INVALID_NODE_ATTRIBUTES",
  "INVALID_PROVIDER_IDENTIFIER",
  "UNSAFE_LINK",
  "UNSUPPORTED_DOCUMENT_SCHEMA_VERSION",
  "UNSUPPORTED_MARK",
  "UNSUPPORTED_NODE",
] as const;

export type PublicationIssueCode = (typeof PUBLICATION_ISSUE_CODES)[number];

export interface PublicationIssue {
  code: PublicationIssueCode;
  path: string;
  message: string;
}

export interface PublicationPreview {
  articleId: string;
  draftVersion: number;
  documentSchemaVersion: number;
  metadata: {
    title: string;
    slug: string;
    summary: string | null;
    tags: string[];
    byline: Byline;
    language: string;
  };
  rendererVersion: number;
  coverHtml: string | null;
  html: string;
}

export interface PublicationReceipt {
  publicationId: string;
  draftVersion: number;
  article: PublicArticle;
}

export interface PreviewSavedDraftCommand {
  articleId: string;
  draftVersion: number;
}

export interface PublishSavedDraftCommand extends PreviewSavedDraftCommand {
  expectedCurrentPublicationId: string | null;
}

export const PUBLICATION_WORKFLOW_ERROR_CODES = [
  "PUBLICATION_NOT_COMPLETED",
  "PUBLICATION_STATE_UNCONFIRMED",
] as const;

export type PublicationWorkflowErrorCode =
  (typeof PUBLICATION_WORKFLOW_ERROR_CODES)[number];

/**
 * Why an attempt could not complete. These are operational failures rather
 * than Publication Issues: the same command may still complete later.
 */
export type PublicationFailureCode =
  PublicationWorkflowErrorCode | "INTERNAL_ERROR";

/**
 * What one Publication Workflow attempt produced.
 *
 * Preview and Publish report the same outcomes for the same state, so a caller
 * states how an outcome is represented once instead of once per operation.
 */
export type PublicationOutcome<Value> =
  | { ok: true; value: Value }
  | { ok: false; reason: "command-invalid" }
  | { ok: false; reason: "invalid"; issues: PublicationIssue[] }
  | { ok: false; reason: "conflict" | "not-found" }
  | { ok: false; reason: "failed"; code: PublicationFailureCode };

export function isPublicationIssue(value: unknown): value is PublicationIssue {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as Partial<PublicationIssue>;
  return (
    typeof issue.code === "string" &&
    PUBLICATION_ISSUE_CODES.includes(issue.code as PublicationIssueCode) &&
    typeof issue.path === "string" &&
    issue.path.startsWith("draft.") &&
    typeof issue.message === "string"
  );
}
