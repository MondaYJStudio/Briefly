CREATE TABLE `purged_article_slug` (
	`slug_key` text PRIMARY KEY NOT NULL,
	`purged_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `article_slug_reject_purged`
BEFORE INSERT ON `article_slug`
WHEN EXISTS (
	SELECT 1 FROM `purged_article_slug`
	WHERE `purged_article_slug`.`slug_key` = NEW.`slug_key`
)
BEGIN
	SELECT RAISE(ABORT, 'slug is permanently tombstoned');
END;
