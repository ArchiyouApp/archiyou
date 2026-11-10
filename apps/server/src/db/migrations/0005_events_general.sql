ALTER TABLE "events" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "script_version_id" text;--> statement-breakpoint
CREATE INDEX "events_by_script_version" ON "events" USING btree ("script_version_id","created");--> statement-breakpoint
UPDATE "events" SET "script_version_id" = "configurations"."source_version_id" FROM "configurations" WHERE "events"."configuration_id" = "configurations"."id" AND "events"."type" IN ('order.received', 'adjust.requested') AND "events"."script_version_id" IS NULL;
