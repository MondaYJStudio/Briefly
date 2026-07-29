import type { JSONContent } from "@tiptap/core";

import type { Byline } from "../site-settings/site-settings";

export const ARTICLE_TITLE_MAXIMUM_LENGTH = 300;
export const ARTICLE_SLUG_MAXIMUM_LENGTH = 200;
export const ARTICLE_SUMMARY_MAXIMUM_LENGTH = 1_000;
export const ARTICLE_TAG_MAXIMUM_LENGTH = 80;
export const ARTICLE_TAGS_MAXIMUM_COUNT = 20;
export const ARTICLE_DRAFT_AUTOSAVE_DEBOUNCE_MS = 1_000;
export const ARTICLE_DOCUMENT_SCHEMA_VERSION = 1 as const;

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

export interface ArticleDraftUpdate {
  version: number;
  title: string;
  slug: string | null;
  summary: string | null;
  tags: string[];
  byline: Byline | null;
  language: string | null;
  document: ArticleDocument;
}
