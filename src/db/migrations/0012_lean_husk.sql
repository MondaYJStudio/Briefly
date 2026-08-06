CREATE TABLE `installed_public_template` (
	`installation_id` text PRIMARY KEY NOT NULL,
	`manifest_id` text NOT NULL,
	`version` text NOT NULL,
	`name` text NOT NULL,
	`installed_at` integer NOT NULL,
	`manifest_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installed_public_template_manifest_id_unique` ON `installed_public_template` (`manifest_id`);--> statement-breakpoint
CREATE TABLE `site_public_presentation` (
	`id` integer PRIMARY KEY NOT NULL,
	`active_installation_id` text,
	FOREIGN KEY (`active_installation_id`) REFERENCES `installed_public_template`(`installation_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "site_public_presentation_singleton" CHECK("site_public_presentation"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `site_public_presentation` (`id`, `active_installation_id`) VALUES (1, NULL);
