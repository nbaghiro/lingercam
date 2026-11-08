import type { EventSettings, EventState } from "@linger/core/events";
import type { ShotState } from "@linger/core/shots";
import type { TierId } from "@linger/core/pricing";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as runMigrations } from "drizzle-orm/postgres-js/migrator";
import {
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    primaryKey,
    text,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { sql as raw } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import postgres from "postgres";
import { errorDetail, log } from "./http.ts";

const time = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const now = (name: string) => time(name).notNull().defaultNow();

export const hosts = pgTable("hosts", {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    createdAt: now("created_at"),
});

export const emailCodes = pgTable("email_codes", {
    email: text("email").primaryKey(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: time("expires_at").notNull(),
});

export const sessions = pgTable("sessions", {
    tokenHash: text("token_hash").primaryKey(),
    hostId: uuid("host_id")
        .notNull()
        .references(() => hosts.id, { onDelete: "cascade" }),
    createdAt: now("created_at"),
    /** Pushed forward each time the session is used; expired sessions are refused and swept. */
    expiresAt: time("expires_at")
        .notNull()
        .default(raw`now() + interval '90 days'`),
});

export const events = pgTable(
    "events",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        code: text("code").notNull().unique(),
        hostId: uuid("host_id")
            .notNull()
            .references(() => hosts.id, { onDelete: "cascade" }),
        state: text("state").$type<EventState>().notNull().default("draft"),
        settings: jsonb("settings").$type<EventSettings>().notNull(),
        tier: text("tier").$type<TierId>().notNull().default("free"),
        unlimitedShots: boolean("unlimited_shots").notNull().default(false),
        guestLimit: integer("guest_limit").notNull(),
        hasCover: boolean("has_cover").notNull().default(false),
        coverVersion: integer("cover_version").notNull().default(0),
        createdAt: now("created_at"),
        revealedAt: time("revealed_at"),
        /** The guest limit the host was last told about, so "is full" is sent once per limit. */
        fullNoticeLimit: integer("full_notice_limit"),
    },
    (t) => [
        index("events_host_idx").on(t.hostId, t.createdAt),
        index("events_state_idx").on(t.state),
    ],
);

export const guests = pgTable(
    "guests",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "cascade" }),
        /** The device id, or "host:<host id>" for the host's own row, which no device can send. */
        device: text("device").notNull(),
        name: text("name").notNull(),
        /** Reserved and confirmed shots; the allowance is checked against this in one UPDATE. */
        shotsTaken: integer("shots_taken").notNull().default(0),
        joinedAt: now("joined_at"),
        /** The host shoots under this row without taking a guest place. One per event. */
        isHost: boolean("is_host").notNull().default(false),
        /** Optional, for the reveal email and for moving to another device. */
        email: text("email"),
        emailedAt: time("emailed_at"),
        /** Hash of the token in the latest email link; the link moves this guest to a device. */
        restoreHash: text("restore_hash").unique(),
        /** When that link was sent; it stops working a week later. */
        restoreIssuedAt: time("restore_issued_at"),
    },
    (t) => [
        uniqueIndex("guests_event_device_idx").on(t.eventId, t.device),
        uniqueIndex("guests_event_host_idx")
            .on(t.eventId)
            .where(raw`${t.isHost}`),
        uniqueIndex("guests_event_email_idx")
            .on(t.eventId, t.email)
            .where(raw`${t.email} is not null`),
    ],
);

export const shots = pgTable(
    "shots",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "cascade" }),
        guestId: uuid("guest_id")
            .notNull()
            .references(() => guests.id, { onDelete: "cascade" }),
        state: text("state").$type<ShotState>().notNull().default("reserved"),
        /** The app's id for the photo, so a retried reservation returns the same shot. */
        clientId: text("client_id"),
        takenAt: now("taken_at"),
        /** When the reservation was made; unconfirmed ones are released after a while. */
        reservedAt: now("reserved_at"),
        width: integer("width"),
        height: integer("height"),
        /** A thumbhash of the developed photo, base64, drawn while the photo loads. */
        placeholder: text("placeholder"),
        hidden: boolean("hidden").notNull().default(false),
        reports: integer("reports").notNull().default(0),
        likes: integer("likes").notNull().default(0),
    },
    (t) => [
        index("shots_event_idx").on(t.eventId, t.takenAt),
        index("shots_guest_idx").on(t.guestId, t.state),
        index("shots_reserved_idx").on(t.state, t.reservedAt),
        uniqueIndex("shots_guest_client_idx").on(t.guestId, t.clientId),
    ],
);

/** One row per person who reported or liked a photo. `who` is "host:<id>" or "guest:<id>". */
export const reports = pgTable(
    "reports",
    {
        shotId: uuid("shot_id")
            .notNull()
            .references(() => shots.id, { onDelete: "cascade" }),
        who: text("who").notNull(),
        createdAt: now("created_at"),
    },
    (t) => [primaryKey({ columns: [t.shotId, t.who] })],
);

export const likes = pgTable(
    "likes",
    {
        shotId: uuid("shot_id")
            .notNull()
            .references(() => shots.id, { onDelete: "cascade" }),
        who: text("who").notNull(),
        createdAt: now("created_at"),
    },
    (t) => [primaryKey({ columns: [t.shotId, t.who] })],
);

/** Devices the host removed from an event. They can't join it again from that device. */
export const removedGuests = pgTable(
    "removed_guests",
    {
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "cascade" }),
        device: text("device").notNull(),
        removedAt: now("removed_at"),
    },
    (t) => [primaryKey({ columns: [t.eventId, t.device] })],
);

/** Expo push tokens, owned by a host or by a guest device. */
export const pushTokens = pgTable(
    "push_tokens",
    {
        token: text("token").primaryKey(),
        hostId: uuid("host_id").references(() => hosts.id, { onDelete: "cascade" }),
        device: text("device"),
        updatedAt: now("updated_at"),
    },
    (t) => [index("push_tokens_device_idx").on(t.device)],
);

export const purchases = pgTable(
    "purchases",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        hostId: uuid("host_id")
            .notNull()
            .references(() => hosts.id, { onDelete: "cascade" }),
        eventId: uuid("event_id")
            .notNull()
            .references(() => events.id, { onDelete: "cascade" }),
        productId: text("product_id").notNull(),
        store: text("store").$type<"app-store" | "play-store" | "stripe" | "dev">().notNull(),
        transactionId: text("transaction_id").notNull(),
        createdAt: now("created_at"),
        refundedAt: time("refunded_at"),
    },
    (t) => [uniqueIndex("purchases_store_tx_idx").on(t.store, t.transactionId)],
);

const schema = {
    hosts,
    emailCodes,
    sessions,
    events,
    guests,
    shots,
    reports,
    likes,
    removedGuests,
    pushTokens,
    purchases,
};

/**
 * Neon's connection strings carry channel_binding=require. postgres.js would send it to the server
 * as a setting, which Postgres refuses, so it's dropped; sslmode=require still keeps TLS on.
 */
export function connectionUrl(url: string): string {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("channel_binding")) return url;
    parsed.searchParams.delete("channel_binding");
    return parsed.toString();
}

export const databaseUrl = connectionUrl(
    process.env.DATABASE_URL ?? "postgres://linger:linger@localhost:8172/linger",
);

export const sql = postgres(databaseUrl, { max: 10, onnotice: () => {} });
export const db = drizzle(sql, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export const QUEUES = [
    "develop",
    "reveal",
    "reveal-sweep",
    "reveal-email",
    "develop-sweep",
    "remove-files",
    "release-reservations",
    "expire-sessions",
    "push-receipts",
] as const;

/**
 * What this process runs. In production the web service is "api" (requests, sends jobs) and the
 * background worker is "worker" (job handlers, crons, developing); locally one process does both.
 */
export const role = (process.env.ROLE ?? "all") as "all" | "api" | "worker";
export const runsJobs = role !== "api";

// pg-boss keeps a LISTEN connection and takes session locks, so DATABASE_URL must be a direct
// connection, not a transaction pooler (on Neon, the host without "-pooler").
export const boss = new PgBoss({
    connectionString: databaseUrl,
    max: 4,
    supervise: runsJobs,
    schedule: runsJobs,
});
// pg-boss emits "error" when a poll or its maintenance can't reach the database. Without a
// listener Node treats that as unhandled and the whole API stops; pg-boss retries on its own.
boss.on("error", (error: unknown) =>
    log("error", "job queue error", { error: errorDetail(error) }, error),
);

let bossStarted: Promise<void> | null = null;

/** Starts pg-boss once and creates the queues. */
export function startQueue(): Promise<void> {
    bossStarted ??= (async () => {
        await boss.start();
        for (const name of QUEUES) await boss.createQueue(name);
    })();
    return bossStarted;
}

export async function stopQueue(): Promise<void> {
    if (!bossStarted) return;
    await bossStarted;
    bossStarted = null;
    // Render waits up to maxShutdownDelaySeconds (60) after SIGTERM; a develop takes about 1 s.
    await boss.stop({ graceful: true, timeout: 30_000 });
}

export async function migrate(): Promise<void> {
    await runMigrations(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
}

// Not top-level await: drizzle-kit loads this file as CommonJS to read the schema.
if (import.meta.main) {
    migrate()
        .then(() => sql.end())
        .catch((error: unknown) => {
            process.stderr.write(`${String(error)}\n`);
            process.exit(1);
        });
}
