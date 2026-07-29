import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  siteName: text("site_name").notNull().default("Briefly"),
  siteDescription: text("site_description"),
  defaultBylineName: text("default_byline_name").notNull().default("Briefly"),
  defaultBylineUrl: text("default_byline_url"),
  defaultLanguage: text("default_language").notNull().default("en"),
});
