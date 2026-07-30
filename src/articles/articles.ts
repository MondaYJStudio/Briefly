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

export interface RenderedArticleDraft {
  articleId: string;
  draftVersion: number;
  documentSchemaVersion: number;
  metadata: {
    title: string;
    slug: string | null;
    summary: string | null;
    tags: string[];
    byline: Byline;
    language: string;
  };
  rendererVersion: number;
  coverHtml: string | null;
  html: string;
}

export interface PublicationIssue {
  code: string;
  path: string;
  message: string;
}

export function isPublicationIssue(value: unknown): value is PublicationIssue {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    "path" in value &&
    typeof value.path === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

export interface ArticleDraftUpdate {
  version: number;
  title: string;
  slug: string | null;
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
