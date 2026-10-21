ALTER TABLE `article` ADD `translation_group_id` text;--> statement-breakpoint
ALTER TABLE `article` ADD `current_publication_language_key` text;--> statement-breakpoint
CREATE INDEX `article_translation_group_id_idx` ON `article` (`translation_group_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `article_translation_group_public_language_unique` ON `article` (`translation_group_id`,`current_publication_language_key`) WHERE "article"."translation_group_id" IS NOT NULL AND "article"."current_publication_id" IS NOT NULL AND "article"."current_publication_language_key" IS NOT NULL;