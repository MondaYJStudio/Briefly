import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Bootstrap capability marker installed by the initial migration. It never
// carries a global schema version; later Workers probe the data they require.
export const runtimeMetadata = sqliteTable(
  "runtime_metadata",
  {
    id: integer("id").primaryKey(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [check("runtime_metadata_singleton", sql`${table.id} = 1`)],
);
