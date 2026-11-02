ALTER TABLE "sessions" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '90 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "client_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "shots_guest_client_idx" ON "shots" USING btree ("guest_id","client_id");