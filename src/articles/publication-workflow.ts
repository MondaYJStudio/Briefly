import type { Byline } from "../site-settings/site-settings";
import type { PublicArticle } from "./articles";

export const PUBLICATION_ISSUE_CODES = [
  "REQUIRED",
  "INVALID",
  "UNSUPPORTED",
  "UNSAFE",
  "UNAVAILABLE",
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

export type PublicationWorkflowResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; reason: "invalid"; issues: PublicationIssue[] }
  | { ok: false; reason: "conflict" | "not-found" };

export const PUBLICATION_WORKFLOW_ERROR_CODES = [
  "PUBLICATION_NOT_COMPLETED",
  "PUBLICATION_STATE_UNCONFIRMED",
] as const;

export type PublicationWorkflowErrorCode =
  (typeof PUBLICATION_WORKFLOW_ERROR_CODES)[number];

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
