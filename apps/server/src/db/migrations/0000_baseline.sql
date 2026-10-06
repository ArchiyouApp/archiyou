CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"script_id" text,
	"file_id" text,
	"script_author" text,
	"script_name" text,
	"script_version" text,
	"url" text,
	"username" text,
	"starred" boolean DEFAULT false NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"author" text,
	"name" text,
	"description" text,
	"details" text,
	"version" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"code" text NOT NULL,
	"params" json,
	"presets" json,
	"published" jsonb,
	"shared" jsonb,
	"thumbnail" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_verified_at" timestamp with time zone,
	"modules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_by_created" ON "feedback" USING btree ("created");--> statement-breakpoint
CREATE INDEX "sv_by_file" ON "script_versions" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "sv_by_author" ON "script_versions" USING btree ("author","updated");--> statement-breakpoint
CREATE INDEX "sv_by_shared" ON "script_versions" USING btree ("author","updated") WHERE shared IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sv_by_published" ON "script_versions" USING btree ("author","updated") WHERE published IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sv_file_version" ON "script_versions" USING btree ("file_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");