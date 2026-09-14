ALTER TABLE `users` ADD `is_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `sv_by_published` ON `script_versions` (`published`) WHERE published IS NOT NULL;