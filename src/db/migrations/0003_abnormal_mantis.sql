CREATE TABLE `article` (
	`id` text PRIMARY KEY NOT NULL,
	`current_publication_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`trashed_at` integer
);
--> statement-breakpoint
CREATE INDEX `article_trashed_at_idx` ON `article` (`trashed_at`);--> statement-breakpoint
CREATE TABLE `article_draft` (
	`article_id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`slug` text,
	`slug_key` text,
	`summary` text,
	`tags` text NOT NULL,
	`byline` text,
	`language` text,
	`document` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "article_draft_version_positive" CHECK("article_draft"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_draft_slug_key_unique` ON `article_draft` (`slug_key`);