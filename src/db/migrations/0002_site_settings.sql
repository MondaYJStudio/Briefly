CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`site_name` text DEFAULT 'Briefly' NOT NULL,
	`site_description` text,
	`default_byline_name` text DEFAULT 'Briefly' NOT NULL,
	`default_byline_url` text,
	`default_language` text DEFAULT 'en' NOT NULL,
	CONSTRAINT "site_settings_singleton" CHECK("site_settings"."id" = 1),
	CONSTRAINT "site_settings_site_name_length" CHECK(length(trim("site_settings"."site_name")) BETWEEN 1 AND 120),
	CONSTRAINT "site_settings_description_length" CHECK("site_settings"."site_description" IS NULL OR length("site_settings"."site_description") <= 500),
	CONSTRAINT "site_settings_byline_name_length" CHECK(length(trim("site_settings"."default_byline_name")) BETWEEN 1 AND 120),
	CONSTRAINT "site_settings_byline_url_length" CHECK("site_settings"."default_byline_url" IS NULL OR length("site_settings"."default_byline_url") <= 2048),
	CONSTRAINT "site_settings_byline_url_scheme" CHECK("site_settings"."default_byline_url" IS NULL OR "site_settings"."default_byline_url" GLOB 'http://*' OR "site_settings"."default_byline_url" GLOB 'https://*'),
	CONSTRAINT "site_settings_language_shape" CHECK(length("site_settings"."default_language") BETWEEN 2 AND 35
        AND "site_settings"."default_language" NOT GLOB '*[^A-Za-z0-9-]*'
        AND "site_settings"."default_language" NOT GLOB '-*'
        AND "site_settings"."default_language" NOT GLOB '*-'
        AND "site_settings"."default_language" NOT GLOB '*--*')
);
--> statement-breakpoint
INSERT INTO `site_settings` (`id`) VALUES (1);
