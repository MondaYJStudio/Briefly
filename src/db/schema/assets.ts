import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const asset = sqliteTable(
  "asset",
  {
    id: text("id").primaryKey(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull(),
    objectKey: text("object_key").notNull(),
    lifecycleState: text("lifecycle_state", {
      enum: ["uploading", "ready", "failed", "pending_deletion"],
    }).notNull(),
    failureCode: text("failure_code"),
    publicAssetId: text("public_asset_id"),
  },
  (table) => [
    uniqueIndex("asset_object_key_unique").on(table.objectKey),
    uniqueIndex("asset_public_asset_id_unique").on(table.publicAssetId),
    index("asset_library_order_idx").on(table.lifecycleState, table.uploadedAt),
    check("asset_byte_size_positive", sql`${table.byteSize} > 0`),
    check("asset_width_positive", sql`${table.width} > 0`),
    check("asset_height_positive", sql`${table.height} > 0`),
  ],
);
