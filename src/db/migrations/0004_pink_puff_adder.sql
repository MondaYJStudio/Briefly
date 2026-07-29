ALTER TABLE `article` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `publication` ADD `publication_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `title` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `publication` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `byline` text DEFAULT '{"name":"","url":null}' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `language` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `cover` text;--> statement-breakpoint
ALTER TABLE `publication` ADD `document_schema_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `document` text DEFAULT '{"documentSchemaVersion":1,"doc":{"type":"doc","content":[{"type":"paragraph"}]}}' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `renderer_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `html` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `publication` ADD `published_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `publication_article_number_unique` ON `publication` (`article_id`,`publication_number`);