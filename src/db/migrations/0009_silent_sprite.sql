CREATE TABLE `publication_asset_reference` (
	`publication_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`public_asset_id` text NOT NULL,
	`asset_lifecycle_state` text DEFAULT 'ready' NOT NULL,
	PRIMARY KEY(`publication_id`, `asset_id`),
	FOREIGN KEY (`publication_id`) REFERENCES `publication`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`,`public_asset_id`,`asset_lifecycle_state`) REFERENCES `asset`(`id`,`public_asset_id`,`lifecycle_state`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "publication_asset_reference_ready" CHECK("publication_asset_reference"."asset_lifecycle_state" = 'ready')
);
--> statement-breakpoint
CREATE INDEX `publication_asset_reference_asset_idx` ON `publication_asset_reference` (`asset_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `asset_public_reference_unique` ON `asset` (`id`,`public_asset_id`,`lifecycle_state`);