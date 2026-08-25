CREATE TABLE `script_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`author` text,
	`name` text,
	`description` text,
	`details` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`code` text NOT NULL,
	`params` text,
	`presets` text,
	`published` text,
	`created` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`shared` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sv_by_file` ON `script_versions` (`file_id`);--> statement-breakpoint
CREATE INDEX `sv_by_author` ON `script_versions` (`author`,`updated`);--> statement-breakpoint
CREATE INDEX `sv_by_shared` ON `script_versions` (`shared`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);