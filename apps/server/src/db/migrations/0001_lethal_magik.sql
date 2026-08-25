PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_script_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`author` text,
	`name` text,
	`description` text,
	`details` text,
	`version` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`code` text NOT NULL,
	`params` text,
	`presets` text,
	`published` text,
	`shared` text,
	`created` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
-- Dev reset (no back-fill): the new `version` column did not exist before, and the
-- old boolean `shared` flag is not a valid ScriptShared JSON object, so neither is
-- copied. Existing scripts are preserved; version starts NULL, shared starts NULL.
INSERT INTO `__new_script_versions`("id", "file_id", "author", "name", "description", "details", "tags", "code", "params", "presets", "published", "created", "updated") SELECT "id", "file_id", "author", "name", "description", "details", "tags", "code", "params", "presets", "published", "created", "updated" FROM `script_versions`;--> statement-breakpoint
DROP TABLE `script_versions`;--> statement-breakpoint
ALTER TABLE `__new_script_versions` RENAME TO `script_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sv_by_file` ON `script_versions` (`file_id`);--> statement-breakpoint
CREATE INDEX `sv_by_author` ON `script_versions` (`author`,`updated`);--> statement-breakpoint
CREATE INDEX `sv_by_shared` ON `script_versions` (`shared`) WHERE shared IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `sv_file_version` ON `script_versions` (`file_id`,`version`);