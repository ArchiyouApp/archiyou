CREATE TABLE "signals" (
	"fingerprint" text NOT NULL,
	"day" date NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"severity" text NOT NULL,
	"script" text,
	"message" text,
	"count" integer DEFAULT 0 NOT NULL,
	"users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sample" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"alerted_at" timestamp with time zone,
	CONSTRAINT "signals_fingerprint_day_pk" PRIMARY KEY("fingerprint","day")
);
--> statement-breakpoint
CREATE INDEX "signals_by_day" ON "signals" USING btree ("day");