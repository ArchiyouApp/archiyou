CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"professional" text NOT NULL,
	"email" text,
	"name" text,
	"company" text,
	"phone" text,
	"address" text,
	"note" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"professional" text NOT NULL,
	"project_id" text NOT NULL,
	"rev" integer NOT NULL,
	"label" text,
	"script" json NOT NULL,
	"values" jsonb NOT NULL,
	"unit_system" text,
	"lang" text,
	"thumbnail" text,
	"origin" text NOT NULL,
	"fulfillment" text,
	"source_version_id" text,
	"source_delivery_id" text,
	"message" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"professional" text NOT NULL,
	"project_id" text NOT NULL,
	"configuration_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"offer" jsonb,
	"recipient_email" text,
	"recipient_name" text,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"token" text,
	"status" text NOT NULL,
	"allow_adjust" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"first_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"download_count" integer DEFAULT 0 NOT NULL,
	"response" text,
	"response_note" text,
	"response_at" timestamp with time zone,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"professional" text NOT NULL,
	"project_id" text NOT NULL,
	"delivery_id" text,
	"configuration_id" text,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"meta" jsonb,
	"visitor" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"professional" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"client_id" text,
	"status" text NOT NULL,
	"note" text,
	"archived_at" timestamp with time zone,
	"client_activity_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clients_by_email" ON "clients" USING btree ("professional","email");--> statement-breakpoint
CREATE INDEX "clients_by_updated" ON "clients" USING btree ("professional","updated");--> statement-breakpoint
CREATE UNIQUE INDEX "configurations_by_rev" ON "configurations" USING btree ("project_id","rev");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_by_token" ON "deliveries" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_by_number" ON "deliveries" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "deliveries_by_sent" ON "deliveries" USING btree ("professional","sent_at");--> statement-breakpoint
CREATE INDEX "events_by_project" ON "events" USING btree ("project_id","created");--> statement-breakpoint
CREATE INDEX "events_by_created" ON "events" USING btree ("created");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_by_number" ON "projects" USING btree ("professional","number");--> statement-breakpoint
CREATE INDEX "projects_by_status" ON "projects" USING btree ("professional","status","updated");