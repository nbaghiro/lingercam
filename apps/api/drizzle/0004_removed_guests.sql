CREATE TABLE "removed_guests" (
	"event_id" uuid NOT NULL,
	"device" text NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "removed_guests_event_id_device_pk" PRIMARY KEY("event_id","device")
);
--> statement-breakpoint
ALTER TABLE "removed_guests" ADD CONSTRAINT "removed_guests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;