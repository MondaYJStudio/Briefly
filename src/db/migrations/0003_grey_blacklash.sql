CREATE TABLE `article` (
	`id` text PRIMARY KEY NOT NULL,
	`current_publication_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`trashed_at` integer,
	FOREIGN KEY (`current_publication_id`,`id`) REFERENCES `publication`(`id`,`article_id`) ON UPDATE no action ON DELETE no action
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
	FOREIGN KEY (`slug_key`,`article_id`) REFERENCES `article_slug`(`slug_key`,`article_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "article_draft_version_positive" CHECK("article_draft"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `article_slug` (
	`slug_key` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`was_published` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_slug_key_article_id_unique` ON `article_slug` (`slug_key`,`article_id`);--> statement-breakpoint
CREATE INDEX `article_slug_article_id_idx` ON `article_slug` (`article_id`);--> statement-breakpoint
CREATE TABLE `publication` (
	`id` text PRIMARY KEY NOT NULL,
	`article_id` text NOT NULL,
	`slug` text NOT NULL,
	`slug_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `article`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slug_key`,`article_id`) REFERENCES `article_slug`(`slug_key`,`article_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publication_id_article_id_unique` ON `publication` (`id`,`article_id`);--> statement-breakpoint
CREATE INDEX `publication_slug_key_idx` ON `publication` (`slug_key`);--> statement-breakpoint
CREATE INDEX `publication_article_id_idx` ON `publication` (`article_id`);