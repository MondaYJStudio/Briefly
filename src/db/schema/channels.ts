import {
  check,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const channel = sqliteTable(
  "channel",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("channel_slug_unique").on(table.slug),
    check("channel_slug_not_empty", sql`length(trim(${table.slug})) > 0`),
    check("channel_name_not_empty", sql`length(trim(${table.name})) > 0`),
  ],
);
