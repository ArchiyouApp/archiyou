ALTER TABLE `users` ADD `email_verified_at` integer;--> statement-breakpoint
-- Grandfather every account that predates email verification. Without this,
-- existing users would come back as unverified after the upgrade and lose the
-- ability to publish or share until they re-confirmed an address they already
-- own. New accounts start with NULL and verify through /auth/verify-email.
UPDATE `users` SET `email_verified_at` = (unixepoch() * 1000) WHERE `email_verified_at` IS NULL;
