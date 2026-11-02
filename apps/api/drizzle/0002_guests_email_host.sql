ALTER TABLE "events" ADD COLUMN "full_notice_limit" integer;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "is_host" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN "restore_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "guests_event_host_idx" ON "guests" USING btree ("event_id") WHERE "guests"."is_host";--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_restore_hash_unique" UNIQUE("restore_hash");--> statement-breakpoint
INSERT INTO "guests" ("event_id", "device", "name", "is_host", "joined_at")
SELECT "events"."id", 'host:' || "events"."host_id", "hosts"."name", true, "events"."created_at"
FROM "events" JOIN "hosts" ON "hosts"."id" = "events"."host_id"
ON CONFLICT DO NOTHING;
