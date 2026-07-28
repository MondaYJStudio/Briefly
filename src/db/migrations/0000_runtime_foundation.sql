CREATE TABLE `runtime_metadata` (
	`id` integer PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "runtime_metadata_singleton" CHECK("runtime_metadata"."id" = 1),
	CONSTRAINT "runtime_metadata_schema_version_positive" CHECK("runtime_metadata"."schema_version" > 0)
);
--> statement-breakpoint
INSERT INTO `runtime_metadata` (`id`, `schema_version`) VALUES (1, 1);
