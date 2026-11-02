ALTER TABLE "guests" ADD COLUMN "restore_issued_at" timestamp with time zone;--> statement-breakpoint
UPDATE "guests" SET "restore_hash" = NULL WHERE "restore_hash" IS NOT NULL;--> statement-breakpoint
UPDATE "guests" SET "email" = NULL
WHERE "id" IN (
    SELECT "id" FROM (
        SELECT "id", row_number() OVER (PARTITION BY "event_id", "email" ORDER BY "joined_at") AS "n"
        FROM "guests" WHERE "email" IS NOT NULL
    ) AS "ranked" WHERE "n" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "guests_event_email_idx" ON "guests" USING btree ("event_id","email") WHERE "guests"."email" is not null;
