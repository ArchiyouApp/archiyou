CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`message` text NOT NULL,
	`script_id` text,
	`file_id` text,
	`script_author` text,
	`script_name` text,
	`script_version` text,
	`url` text,
	`username` text,
	`starred` integer DEFAULT false NOT NULL,
	`created` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_by_created` ON `feedback` (`created`);