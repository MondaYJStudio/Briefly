import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { asset } from "./assets";
import type { VideoProviderFacts } from "../../articles/video-embeds";

export const article = sqliteTable(
  "article",
  {
    id: text("id").primaryKey(),
    currentPublicationId: text("current_publication_id"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("article_trashed_at_idx").on(table.trashedAt),
    foreignKey({
      columns: [table.currentPublicationId, table.id],
      foreignColumns: [publication.id, publication.articleId],
      name: "article_current_publication_belongs_to_article",
    }),
  ],
);

export const articleSlug = sqliteTable(
  "article_slug",
  {
    slugKey: text("slug_key").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references((): AnySQLiteColumn => article.id, { onDelete: "cascade" }),
    wasPublished: integer("was_published", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    uniqueIndex("article_slug_key_article_id_unique").on(
      table.slugKey,
      table.articleId,
    ),
    index("article_slug_article_id_idx").on(table.articleId),
  ],
);

export const publication = sqliteTable(
  "publication",
  {
    id: text("id").primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references((): AnySQLiteColumn => article.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    slugKey: text("slug_key").notNull(),
    publicationNumber: integer("publication_number").notNull().default(1),
    title: text("title").notNull().default(""),
    summary: text("summary"),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    byline: text("byline", { mode: "json" })
      .$type<{ name: string; url: string | null }>()
      .notNull()
      .default({ name: "", url: null }),
    language: text("language").notNull().default(""),
    cover: text("cover", { mode: "json" }).$type<unknown | null>(),
    documentSchemaVersion: integer("document_schema_version")
      .notNull()
      .default(1),
    document: text("document", { mode: "json" })
      .$type<unknown>()
      .notNull()
      .default({
        documentSchemaVersion: 1,
        doc: { type: "doc", content: [{ type: "paragraph" }] },
      }),
    rendererVersion: integer("renderer_version").notNull().default(1),
    providerFacts: text("provider_facts", { mode: "json" })
      .$type<VideoProviderFacts[]>()
      .notNull()
      .default([]),
    html: text("html").notNull().default(""),
    publishedAt: integer("published_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`0`),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("publication_id_article_id_unique").on(
      table.id,
      table.articleId,
    ),
    uniqueIndex("publication_article_number_unique").on(
      table.articleId,
      table.publicationNumber,
    ),
    foreignKey({
      columns: [table.slugKey, table.articleId],
      foreignColumns: [articleSlug.slugKey, articleSlug.articleId],
      name: "publication_slug_belongs_to_article",
    }),
    index("publication_slug_key_idx").on(table.slugKey),
    index("publication_article_id_idx").on(table.articleId),
  ],
);

export const articleDraft = sqliteTable(
  "article_draft",
  {
    articleId: text("article_id")
      .primaryKey()
      .references(() => article.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    title: text("title").notNull().default(""),
    slug: text("slug"),
    slugKey: text("slug_key"),
    summary: text("summary"),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    byline: text("byline", { mode: "json" }).$type<{
      name: string;
      url: string | null;
    } | null>(),
    language: text("language"),
    cover: text("cover", { mode: "json" }).$type<{
      assetId: string;
      alt: string;
    } | null>(),
    document: text("document", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.slugKey, table.articleId],
      foreignColumns: [articleSlug.slugKey, articleSlug.articleId],
      name: "article_draft_slug_belongs_to_article",
    }),
    check("article_draft_version_positive", sql`${table.version} >= 1`),
  ],
);

export const articleDraftAssetReference = sqliteTable(
  "article_draft_asset_reference",
  {
    articleId: text("article_id")
      .notNull()
      .references(() => articleDraft.articleId, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => asset.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.articleId, table.assetId] }),
    index("article_draft_asset_reference_asset_idx").on(table.assetId),
  ],
);
