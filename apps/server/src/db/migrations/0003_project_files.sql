CREATE TABLE "project_files" (
	"id" text PRIMARY KEY NOT NULL,
	"professional" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "project_files_by_project" ON "project_files" USING btree ("project_id","created");--> statement-breakpoint
CREATE INDEX "project_files_by_professional" ON "project_files" USING btree ("professional");