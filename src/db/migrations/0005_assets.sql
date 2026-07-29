CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`uploaded_at` integer NOT NULL,
	`object_key` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`failure_code` text,
	`public_asset_id` text,
	CONSTRAINT "asset_byte_size_positive" CHECK("asset"."byte_size" > 0),
	CONSTRAINT "asset_width_positive" CHECK("asset"."width" > 0),
	CONSTRAINT "asset_height_positive" CHECK("asset"."height" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_object_key_unique` ON `asset` (`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_public_asset_id_unique` ON `asset` (`public_asset_id`);--> statement-breakpoint
CREATE INDEX `asset_library_order_idx` ON `asset` (`lifecycle_state`,`uploaded_at`);