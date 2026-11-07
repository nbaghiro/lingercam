import { z } from "zod";
import { LOOK_IDS } from "./film.ts";
import { TIER_IDS } from "./pricing.ts";
import { revealTime } from "./reveal.ts";

export const OCCASIONS = ["wedding", "birthday", "trip", "party", "everyday"] as const;
export const Occasion = z.enum(OCCASIONS);
export type Occasion = z.infer<typeof Occasion>;

export const EVENT_STATES = ["draft", "live", "ended", "revealed", "archived"] as const;
export const EventState = z.enum(EVENT_STATES);
export type EventState = z.infer<typeof EventState>;

export const REVEAL_MODES = ["right-away", "at-end", "next-morning", "custom"] as const;
export const RevealMode = z.enum(REVEAL_MODES);
export type RevealMode = z.infer<typeof RevealMode>;

export const Visibility = z.enum(["everyone", "host-only"]);
export type Visibility = z.infer<typeof Visibility>;

export const MIN_SHOTS = 5;
export const MAX_SHOTS = 36;
export const DEFAULT_SHOTS = 24;
export const TITLE_MAX = 60;
export const NAME_MAX = 40;
/** Days a revealed event stays open before it is archived. */
export const ARCHIVE_AFTER_DAYS = 90;

const TRANSITIONS: Record<EventState, readonly EventState[]> = {
    draft: ["live"],
    live: ["ended", "revealed"],
    ended: ["revealed"],
    revealed: ["archived"],
    archived: [],
};

export function canTransition(from: EventState, to: EventState): boolean {
    return TRANSITIONS[from].includes(to);
}

const DAY_MS = 86_400_000;

/**
 * The state an event should be in at `now`, from its times alone: live becomes ended at the end,
 * and revealed at the reveal (straight from live when they coincide); revealed becomes archived
 * ARCHIVE_AFTER_DAYS after the reveal. Drafts and archived events never move on their own.
 */
export function dueState(
    state: EventState,
    settings: Parameters<typeof revealTime>[0],
    revealedAt: Date | null,
    now: Date,
): EventState {
    const t = now.getTime();
    const ends = Date.parse(settings.endsAt);
    const reveals = revealTime(settings).getTime();
    switch (state) {
        case "live":
            if (t < ends) return "live";
            return t >= reveals ? "revealed" : "ended";
        case "ended":
            return t >= reveals ? "revealed" : "ended";
        case "revealed": {
            const since = revealedAt?.getTime() ?? t;
            return t - since >= ARCHIVE_AFTER_DAYS * DAY_MS ? "archived" : "revealed";
        }
        default:
            return state;
    }
}

/** How long after the camera closes someone new can still join, for a guest who came late. */
export const LATE_JOIN_MS = 60 * 60_000;

/**
 * Whether someone new can join: while the event is live, and for an hour after the camera
 * closes. After that only people who already joined get in, so a code passed on overnight
 * doesn't open the photos.
 */
export function joinsOpen(
    state: EventState,
    settings: Parameters<typeof revealTime>[0],
    revealedAt: Date | null,
    now: Date,
): boolean {
    const due = dueState(state, settings, revealedAt, now);
    if (due === "live") return true;
    return due === "ended" && now.getTime() < Date.parse(settings.endsAt) + LATE_JOIN_MS;
}

export function isTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
    } catch {
        return false;
    }
}

const Instant = z.iso.datetime({ offset: true });

const SettingsShape = z.object({
    occasion: Occasion,
    title: z.string().trim().min(1).max(TITLE_MAX),
    startsAt: Instant,
    endsAt: Instant,
    timeZone: z.string().refine(isTimeZone, "Unknown time zone"),
    revealMode: RevealMode,
    revealAt: Instant.optional(),
    shotsPerGuest: z.number().int().min(MIN_SHOTS).max(MAX_SHOTS).nullable(),
    visibility: Visibility,
    look: z.enum(LOOK_IDS),
});

type SettingsInput = z.infer<typeof SettingsShape>;

/** Rules that span fields. Returns the problems found, empty when the settings hold together. */
export function settingsProblems(s: SettingsInput): { path: string; message: string }[] {
    const problems: { path: string; message: string }[] = [];
    const starts = Date.parse(s.startsAt);
    const ends = Date.parse(s.endsAt);
    if (ends <= starts)
        problems.push({
            path: "endsAt",
            message: "The end must be after the start",
        });
    if (s.revealMode === "custom") {
        if (s.revealAt === undefined) {
            problems.push({
                path: "revealAt",
                message: "Choose when the photos appear",
            });
        } else if (Date.parse(s.revealAt) < ends) {
            problems.push({
                path: "revealAt",
                message: "The reveal can't be before the end",
            });
        }
    } else if (s.revealAt !== undefined) {
        problems.push({
            path: "revealAt",
            message: "A reveal time is only used with custom",
        });
    }
    return problems;
}

export const EventSettings = SettingsShape.superRefine((s, ctx) => {
    for (const p of settingsProblems(s)) {
        ctx.addIssue({ code: "custom", path: [p.path], message: p.message });
    }
});
export type EventSettings = z.infer<typeof EventSettings>;

/** A PATCH body. The server merges it into the stored settings and validates the result. */
export const EventSettingsPatch = SettingsShape.partial();
export type EventSettingsPatch = z.infer<typeof EventSettingsPatch>;

type SettingKey = keyof EventSettings;

const EDITABLE: Record<EventState, readonly SettingKey[]> = {
    draft: Object.keys(SettingsShape.shape) as SettingKey[],
    live: ["title", "endsAt", "revealMode", "revealAt", "visibility"],
    ended: ["title", "revealMode", "revealAt", "visibility"],
    revealed: ["title", "visibility"],
    archived: [],
};

/**
 * The keys in a patch that can't change now. Past the draft, the state limits which keys can
 * change, and guests who already shot are protected: visibility can only get stricter, and the
 * reveal can only move later (ending early through /end is the one way to bring it forward).
 */
export function lockedSettings(
    event: { state: EventState; settings: EventSettings },
    patch: EventSettingsPatch,
): SettingKey[] {
    const allowed = EDITABLE[event.state];
    const keys = (Object.keys(patch) as SettingKey[]).filter((key) => patch[key] !== undefined);
    const locked = keys.filter((key) => !allowed.includes(key));
    if (event.state === "draft") return locked;
    const current = event.settings;
    const lock = (key: SettingKey) => {
        if (keys.includes(key) && !locked.includes(key)) locked.push(key);
    };
    if (patch.visibility === "everyone" && current.visibility === "host-only") lock("visibility");
    if (patch.revealMode !== undefined || patch.revealAt !== undefined) {
        const changes = Object.entries(patch).filter(([, value]) => value !== undefined);
        const merged = { ...current, ...Object.fromEntries(changes) } as EventSettings;
        const later =
            merged.revealMode === "right-away"
                ? current.revealMode === "right-away"
                : revealTime(merged).getTime() >= revealTime(current).getTime();
        if (!later) {
            lock("revealMode");
            lock("revealAt");
        }
    }
    return locked;
}

export const Event = z.object({
    id: z.string(),
    code: z.string(),
    hostId: z.string(),
    state: EventState,
    settings: EventSettings,
    tier: z.enum(TIER_IDS),
    unlimitedShots: z.boolean(),
    guestLimit: z.number().int(),
    coverUrl: z.string().nullable(),
    createdAt: Instant,
    /** When the photos appear, worked out by the server so every device agrees. */
    revealsAt: Instant,
    revealedAt: Instant.nullable(),
    /** Photos taken so far (confirmed uploads and developed photos), hidden ones included. */
    photoCount: z.number().int(),
    /** Guests who joined. The host doesn't count. */
    guestCount: z.number().int(),
});
export type Event = z.infer<typeof Event>;

/**
 * Who is asking, as the summary sees it. The host is "host" with the guest id their own photos
 * are filed under; a device that joined is "guest"; anyone else is "none" with the allowance a new
 * guest would get. `shotsLeft` is null when shots are unlimited.
 */
export const SummaryViewer = z.object({
    role: z.enum(["host", "guest", "none"]),
    guestId: z.string().nullable(),
    shotsTaken: z.number().int(),
    shotsLeft: z.number().int().nullable(),
});
export type SummaryViewer = z.infer<typeof SummaryViewer>;

/**
 * What anyone with the join code may see before joining, plus who is viewing. `state` is the
 * time-driven state (`dueState`), so it says "revealed" the moment the reveal time passes, before
 * the reveal job has run. `now` is the server's clock, for countdowns that don't trust the device.
 */
export const EventSummary = z.object({
    code: z.string(),
    title: z.string(),
    occasion: Occasion,
    state: EventState,
    hostName: z.string(),
    coverUrl: z.string().nullable(),
    startsAt: Instant,
    endsAt: Instant,
    timeZone: z.string(),
    revealMode: RevealMode,
    revealsAt: Instant,
    shotsPerGuest: z.number().int().nullable(),
    look: z.enum(LOOK_IDS),
    /** Guests who joined; the host doesn't count. */
    guestCount: z.number().int(),
    full: z.boolean(),
    /** Only for the host; null for everyone else. */
    guestLimit: z.number().int().nullable(),
    /** Photos taken so far; after the reveal, the photos everyone can see. */
    photoCount: z.number().int(),
    photographerCount: z.number().int(),
    viewer: SummaryViewer,
    now: Instant,
});
export type EventSummary = z.infer<typeof EventSummary>;

/**
 * One row of `GET /v1/e/:code/people`. The host comes first with `host` true, even before they
 * shoot. `shots` counts photos the viewer can see: before the reveal every photo taken, after it
 * only developed photos, without hidden ones for guests.
 */
export const Person = z.object({
    id: z.string(),
    name: z.string(),
    shots: z.number().int(),
    joinedAt: Instant,
    host: z.boolean(),
});
export type Person = z.infer<typeof Person>;

/** The first word of a name, for developing tiles: "Priya" from "Priya R.". */
export function firstName(name: string): string {
    return name.trim().split(/\s+/)[0] ?? "";
}

export const Guest = z.object({
    id: z.string(),
    eventId: z.string(),
    name: z.string(),
    shotsTaken: z.number().int(),
    joinedAt: Instant,
});
export type Guest = z.infer<typeof Guest>;

/** A random id the app stores on first launch and sends as `X-Device`. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export const JoinRequest = z.object({
    name: z.string().trim().min(1).max(NAME_MAX),
    device: DeviceId,
});
export type JoinRequest = z.infer<typeof JoinRequest>;

export const EMAIL_MAX = 254;
const Email = z.string().trim().toLowerCase().max(EMAIL_MAX).pipe(z.email());

/** `POST /v1/e/:code/email`: where a guest wants the reveal email; null forgets it. */
export const GuestEmailRequest = z.object({ email: Email.nullable() });
export type GuestEmailRequest = z.infer<typeof GuestEmailRequest>;

/** `POST /v1/e/:code/restore/send`: "I joined on another device". */
export const RestoreSendRequest = z.object({ email: Email });
export type RestoreSendRequest = z.infer<typeof RestoreSendRequest>;

/** `POST /v1/e/:code/restore`: the token from an email link moves that guest to this device. */
export const RestoreRequest = z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
    device: DeviceId,
});
export type RestoreRequest = z.infer<typeof RestoreRequest>;

/** Shots a guest has left, or null when the event has unlimited shots. */
export function shotsLeft(
    event: Pick<Event, "settings" | "unlimitedShots">,
    guest: Pick<Guest, "shotsTaken">,
): number | null {
    const allowance = event.unlimitedShots ? null : event.settings.shotsPerGuest;
    if (allowance === null) return null;
    return Math.max(0, allowance - guest.shotsTaken);
}

/** Unambiguous: no 0, 1, I, L, O or U. */
export const JOIN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const JOIN_CODE_LENGTH = 6;

function randomBytes(count: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(count));
}

export function joinCode(random: (count: number) => Uint8Array = randomBytes): string {
    const n = JOIN_ALPHABET.length;
    // Rejection sampling keeps every character equally likely.
    const limit = 256 - (256 % n);
    let code = "";
    while (code.length < JOIN_CODE_LENGTH) {
        for (const byte of random(JOIN_CODE_LENGTH)) {
            if (byte < limit && code.length < JOIN_CODE_LENGTH) code += JOIN_ALPHABET[byte % n];
        }
    }
    return code;
}

/** Uppercases and trims what someone typed; returns null if it can't be a join code. */
export function normalizeJoinCode(input: string): string | null {
    const code = input.trim().toUpperCase();
    if (code.length !== JOIN_CODE_LENGTH) return null;
    for (const ch of code) if (!JOIN_ALPHABET.includes(ch)) return null;
    return code;
}
