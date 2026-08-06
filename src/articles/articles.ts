import type { JSONContent } from "@tiptap/core";

import type { Byline } from "../site-settings/site-settings";

export const ARTICLE_TITLE_MAXIMUM_LENGTH = 300;
export const ARTICLE_SLUG_MAXIMUM_LENGTH = 200;
export const ARTICLE_SUMMARY_MAXIMUM_LENGTH = 1_000;
export const ARTICLE_TAG_MAXIMUM_LENGTH = 80;
export const ARTICLE_TAGS_MAXIMUM_COUNT = 20;
export const ARTICLE_DRAFT_AUTOSAVE_DEBOUNCE_MS = 1_000;
export const ARTICLE_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const ARTICLE_ASSET_ALT_MAXIMUM_LENGTH = 1_000;
export const ARTICLE_FIGURE_CAPTION_MAXIMUM_LENGTH = 2_000;

export interface ArticleCoverUsage {
  assetId: string;
  alt: string;
}

export interface ArticleDocument {
  documentSchemaVersion: typeof ARTICLE_DOCUMENT_SCHEMA_VERSION;
  doc: {
    type: "doc";
    content: JSONContent[];
  };
}

export interface ArticleDraft {
  version: number;
  title: string;
  slug: string | null;
  /** When false, Slug follows Title; when true, Title changes leave Slug alone. */
  slugIsManual: boolean;
  summary: string | null;
  tags: string[];
  byline: Byline | null;
  language: string | null;
  cover: ArticleCoverUsage | null;
  document: ArticleDocument;
  createdAt: string;
  updatedAt: string;
}

export interface Article {
  id: string;
  currentPublicationId: string | null;
  createdAt: string;
  updatedAt: string;
  draft: ArticleDraft;
}

/**
 * Server-derived Articles workspace presentation. Not a persisted domain
 * status — computed from Publication history and effective Draft divergence
 * (including inherited Site Settings metadata) against the Current Publication.
 */
export type ArticleLifecycleProjection =
  "draft" | "published" | "changes-pending" | "unpublished";

export interface AdminArticleListItem extends Article {
  lifecycleProjection: ArticleLifecycleProjection;
}

export interface ArticleTrashEntry {
  id: string;
  title: string;
  slug: string | null;
  draftVersion: number;
  publicationCount: number;
  currentPublicationId: null;
  trashedAt: string;
}

export interface ArticleTrashTransition {
  id: string;
  currentPublicationId: null;
  trashedAt: string;
}

export interface ArticleRestoreTransition {
  id: string;
  currentPublicationId: null;
}

export interface ArticlePublicationHistoryEntry {
  id: string;
  publicationNumber: number;
  title: string;
  slug: string;
  publishedAt: string;
  isCurrent: boolean;
}

export interface ArticlePublicationHistory {
  publications: ArticlePublicationHistoryEntry[];
  hasUnpublishedChanges: boolean;
}

export interface ArticleDraftUpdate {
  version: number;
  title: string;
  slug: string | null;
  slugIsManual: boolean;
  summary: string | null;
  tags: string[];
  byline: Byline | null;
  language: string | null;
  cover: ArticleCoverUsage | null;
  document: ArticleDocument;
}

export interface PublicArticle {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  tags: string[];
  byline: Byline;
  language: string;
  cover: PublicArticleCover | null;
  publishedAt: string;
  updatedAt: string;
  html: string;
}

export type PublicArticleListItem = Omit<PublicArticle, "html">;

export interface PublicArticleCover {
  url: string;
  width: number;
  height: number;
  alt: string;
}
