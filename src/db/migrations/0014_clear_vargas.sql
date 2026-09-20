CREATE TABLE `channel` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "channel_slug_not_empty" CHECK(length(trim("channel"."slug")) > 0),
	CONSTRAINT "channel_name_not_empty" CHECK(length(trim("channel"."name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_slug_unique` ON `channel` (`slug`);--> statement-breakpoint
ALTER TABLE `article_draft` ADD `channel_slug` text REFERENCES channel(slug);--> statement-breakpoint
CREATE INDEX `article_draft_channel_slug_idx` ON `article_draft` (`channel_slug`);--> statement-breakpoint
ALTER TABLE `publication` ADD `channel_slug` text;--> statement-breakpoint
ALTER TABLE `publication` ADD `channel_name` text;--> statement-breakpoint
CREATE INDEX `publication_channel_slug_idx` ON `publication` (`channel_slug`);