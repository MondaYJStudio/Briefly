import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const runtimeMetadata = sqliteTable(
  "runtime_metadata",
  {
    id: integer("id").primaryKey(),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    check("runtime_metadata_singleton", sql`${table.id} = 1`),
    check(
      "runtime_metadata_schema_version_positive",
      sql`${table.schemaVersion} > 0`,
    ),
  ],
);
