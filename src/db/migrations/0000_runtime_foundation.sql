CREATE TABLE `runtime_metadata` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "runtime_metadata_singleton" CHECK("runtime_metadata"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `runtime_metadata` (`id`) VALUES (1);
