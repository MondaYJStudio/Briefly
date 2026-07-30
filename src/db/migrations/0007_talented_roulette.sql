CREATE TABLE `article_draft_asset_reference` (
	`article_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`article_id`, `asset_id`),
	FOREIGN KEY (`article_id`) REFERENCES `article_draft`(`article_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `article_draft_asset_reference_asset_idx` ON `article_draft_asset_reference` (`asset_id`);