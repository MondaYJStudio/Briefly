CREATE TABLE `auth_oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`refresh_token_expires_at` integer NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `auth_oauth_application`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_access_token_access_token_unique` ON `auth_oauth_access_token` (`access_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_access_token_refresh_token_unique` ON `auth_oauth_access_token` (`refresh_token`);--> statement-breakpoint
CREATE INDEX `auth_oauth_access_token_client_id_idx` ON `auth_oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_access_token_user_id_idx` ON `auth_oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_oauth_application` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text,
	`metadata` text,
	`client_id` text NOT NULL,
	`client_secret` text,
	`redirect_urls` text NOT NULL,
	`type` text NOT NULL,
	`disabled` integer DEFAULT false,
	`user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_oauth_application_client_id_unique` ON `auth_oauth_application` (`client_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_application_user_id_idx` ON `auth_oauth_application` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`consent_given` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `auth_oauth_application`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_oauth_consent_client_id_idx` ON `auth_oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `auth_oauth_consent_user_id_idx` ON `auth_oauth_consent` (`user_id`);