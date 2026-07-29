import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const siteSettings = sqliteTable(
  "site_settings",
  {
    id: integer("id").primaryKey(),
    siteName: text("site_name").notNull().default("Briefly"),
    siteDescription: text("site_description"),
    defaultBylineName: text("default_byline_name").notNull().default("Briefly"),
    defaultBylineUrl: text("default_byline_url"),
    defaultLanguage: text("default_language").notNull().default("en"),
  },
  (table) => [
    check("site_settings_singleton", sql`${table.id} = 1`),
    check(
      "site_settings_site_name_length",
      sql`length(trim(${table.siteName})) BETWEEN 1 AND 120`,
    ),
    check(
      "site_settings_description_length",
      sql`${table.siteDescription} IS NULL OR length(${table.siteDescription}) <= 500`,
    ),
    check(
      "site_settings_byline_name_length",
      sql`length(trim(${table.defaultBylineName})) BETWEEN 1 AND 120`,
    ),
    check(
      "site_settings_byline_url_length",
      sql`${table.defaultBylineUrl} IS NULL OR length(${table.defaultBylineUrl}) <= 2048`,
    ),
    check(
      "site_settings_byline_url_scheme",
      sql`${table.defaultBylineUrl} IS NULL OR ${table.defaultBylineUrl} GLOB 'http://*' OR ${table.defaultBylineUrl} GLOB 'https://*'`,
    ),
    check(
      "site_settings_language_shape",
      sql`length(${table.defaultLanguage}) BETWEEN 2 AND 35
        AND ${table.defaultLanguage} NOT GLOB '*[^A-Za-z0-9-]*'
        AND ${table.defaultLanguage} NOT GLOB '-*'
        AND ${table.defaultLanguage} NOT GLOB '*-'
        AND ${table.defaultLanguage} NOT GLOB '*--*'`,
    ),
  ],
);
