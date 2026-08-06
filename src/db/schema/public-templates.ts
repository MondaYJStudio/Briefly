import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const installedPublicTemplate = sqliteTable(
  "installed_public_template",
  {
    installationId: text("installation_id").primaryKey(),
    manifestId: text("manifest_id").notNull(),
    version: text("version").notNull(),
    name: text("name").notNull(),
    installedAt: integer("installed_at", { mode: "timestamp_ms" }).notNull(),
    manifestJson: text("manifest_json").notNull(),
  },
  (table) => [
    uniqueIndex("installed_public_template_manifest_id_unique").on(
      table.manifestId,
    ),
  ],
);

export const sitePublicPresentation = sqliteTable(
  "site_public_presentation",
  {
    id: integer("id").primaryKey(),
    activeInstallationId: text("active_installation_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.activeInstallationId],
      foreignColumns: [installedPublicTemplate.installationId],
      name: "site_public_presentation_active_installation_id_fk",
    }),
    check("site_public_presentation_singleton", sql`${table.id} = 1`),
  ],
);
