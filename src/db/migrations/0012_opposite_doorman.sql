ALTER TABLE `site_settings` ADD `site_descriptions` text DEFAULT 'null';
--> statement-breakpoint
UPDATE `site_settings`
SET `site_descriptions` = json_object('en', `site_description`)
WHERE `site_descriptions` = 'null';
