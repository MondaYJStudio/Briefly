import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const article = sqliteTable(
  "article",
  {
    id: text("id").primaryKey(),
    currentPublicationId: text("current_publication_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    trashedAt: integer("trashed_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("article_trashed_at_idx").on(table.trashedAt)],
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
    document: text("document", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("article_draft_slug_key_unique").on(table.slugKey),
    check("article_draft_version_positive", sql`${table.version} >= 1`),
  ],
);
