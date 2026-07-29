CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`site_name` text DEFAULT 'Briefly' NOT NULL,
	`site_description` text,
	`default_byline_name` text DEFAULT 'Briefly' NOT NULL,
	`default_byline_url` text,
	`default_language` text DEFAULT 'en' NOT NULL
);
--> statement-breakpoint
INSERT INTO `site_settings` (`id`) VALUES (1);
