CREATE TABLE "links" (
	"key" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"target" text,
	"status" text NOT NULL,
	"message" text,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "links_by_owner" ON "links" USING btree ("owner");