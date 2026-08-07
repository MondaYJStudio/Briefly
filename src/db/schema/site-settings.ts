import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  siteName: text("site_name").notNull().default("Briefly"),
  siteDescription: text("site_description"),
  // Keep the original scalar column for backwards compatibility with
  // installations created before localized site descriptions were added.
  // New writes use this JSON object as the source of truth and mirror the
  // English value to `site_description`.
  siteDescriptions: text("site_descriptions", { mode: "json" })
    .$type<Record<string, string | null> | null>()
    .default(null),
  defaultBylineName: text("default_byline_name").notNull().default("Briefly"),
  defaultBylineUrl: text("default_byline_url"),
  defaultLanguage: text("default_language").notNull().default("en"),
});
