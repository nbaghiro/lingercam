import {
    Event,
    EventSummary,
    Guest,
    Person,
    type EventSettings,
    type EventSettingsPatch,
} from "@linger/core/events";
import type { TierId } from "@linger/core/pricing";
import { GalleryPage, Highlights, Shot, type HighlightsFor } from "@linger/core/shots";
import { randomUUID } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";
import { z } from "zod";

const LOCAL_API = Platform.OS === "android" ? "http://10.0.2.2:8171" : "http://localhost:8171";

export const API_URL = process.env.EXPO_PUBLIC_API_URL || LOCAL_API;
export const JOIN_URL = process.env.EXPO_PUBLIC_JOIN_URL || "http://localhost:8173";
export const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL || "http://localhost:8170";

/** The link a QR code or share sheet points guests to. */
export function joinLink(code: string): string {
    return __DEV__ ? `${JOIN_URL}/j/${code}` : `${JOIN_URL}/${code}`;
}

/** The `.ics` file with the event's reveal time, for "Add to calendar". */
export function calendarLink(code: string): string {
    return `${API_URL}/v1/e/${code}/calendar.ics`;
}

export function siteLink(path: "privacy" | "terms" | "support" | "delete-account"): string {
    return `${SITE_URL}/${path}`;
}

// Schemas for what the API returns. Core owns the shared shapes; the rest are envelopes.

export const Host = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    createdAt: z.string(),
});
export type Host = z.infer<typeof Host>;

const SessionResponse = z.object({ session: z.string(), host: Host });
export type Session = z.infer<typeof SessionResponse>;

const HostEnvelope = z.object({ host: Host }).transform((r) => r.host);

const GuestResponse = z.object({
    guest: Guest,
    shotsLeft: z.number().int().nullable(),
    /** Photos the server couldn't develop and gave back as shots. */
    returned: z.number().int().optional(),
});
export type GuestResponse = z.infer<typeof GuestResponse>;

const PeopleResponse = z.object({ people: z.array(Person), guestLimit: z.number().int() });
export type People = z.infer<typeof PeopleResponse>;

const Reservation = z.object({
    shotId: z.string(),
    uploadUrl: z.string(),
    shotsLeft: z.number().int().nullable(),
});
export type Reservation = z.infer<typeof Reservation>;

const LikeResponse = z.object({ liked: z.boolean(), likes: z.number().int() });

const CoverUpload = z.object({ uploadUrl: z.string(), coverUrl: z.string().nullable() });

const Checkout = z.object({ url: z.string() });

const ShotEnvelope = z.object({ shot: Shot }).transform((r) => r.shot);
const ReportResponse = z.object({ reported: z.boolean(), hidden: z.boolean().optional() });

const Ok = z.unknown();
const EmailResponse = z.object({ email: z.string().nullable() });

/**
 * An error the API reported as `{ code, message }`. Failures before a response are "network" or
 * "timeout"; a response the app can't read is "bad-response". `problem(code)` in copy.ts says
 * what to show; the message is for logs only.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function asApiError(error: unknown): ApiError {
    if (error instanceof ApiError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new ApiError(0, "network", message);
}

// Device storage. MMKV is backed by localStorage on the web.

export const storage = createMMKV({ id: "linger" });

const DEVICE_KEY = "device";
/** The push token last sent to the API, with the host it was sent for. */
export const PUSH_KEY = "push";

// The device id lives in the keychain on iOS, which survives a reinstall, so a guest who
// reinstalls is still the same guest. MMKV keeps a copy for the web and as the first source.
const KEYCHAIN_DEVICE = "linger.device";
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

let device: string | undefined;

function readKeychainDevice(): string | null {
    try {
        return SecureStore.getItem(KEYCHAIN_DEVICE, KEYCHAIN_OPTIONS);
    } catch {
        return null;
    }
}

/** A random id made on first launch. Guests are known to an event by this id. */
export function deviceId(): string {
    if (device) return device;
    const local = storage.getString(DEVICE_KEY);
    const kept = Platform.OS === "web" ? null : readKeychainDevice();
    device = kept ?? local ?? randomUUID();
    if (Platform.OS !== "web" && kept !== device) {
        try {
            SecureStore.setItem(KEYCHAIN_DEVICE, device, KEYCHAIN_OPTIONS);
        } catch {
            // The MMKV copy still works until the next reinstall.
        }
    }
    if (local !== device) storage.set(DEVICE_KEY, device);
    return device;
}

// The host session lives in the keychain on iOS and Android, and in localStorage on the web.

const SESSION_KEY = "linger.session";

const secret = {
    async get(): Promise<string | null> {
        if (Platform.OS === "web") return globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
        return SecureStore.getItemAsync(SESSION_KEY);
    },
    async set(value: string): Promise<void> {
        if (Platform.OS === "web") return globalThis.localStorage?.setItem(SESSION_KEY, value);
        return SecureStore.setItemAsync(SESSION_KEY, value);
    },
    async remove(): Promise<void> {
        if (Platform.OS === "web") return globalThis.localStorage?.removeItem(SESSION_KEY);
        return SecureStore.deleteItemAsync(SESSION_KEY);
    },
};

/** `undefined` until the stored session has been read, then the session or `null`. */
let current: Session | null | undefined;
let loading: Promise<void> | null = null;
/** True after the server ended a session, until Welcome has said so once. */
let signedOut = false;
const listeners = new Set<() => void>();

function publish(next: Session | null): void {
    current = next;
    for (const listener of listeners) listener();
}

function subscribeSession(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Reads the stored session once. Safe to call more than once. */
export function loadSession(): Promise<void> {
    loading ??= secret
        .get()
        .then((raw) => {
            const parsed = raw ? SessionResponse.safeParse(JSON.parse(raw)) : null;
            publish(parsed?.success ? parsed.data : null);
        })
        .catch(() => publish(null));
    return loading;
}

async function saveSession(next: Session | null): Promise<void> {
    publish(next);
    if (next) await secret.set(JSON.stringify(next));
    else await secret.remove();
}

/** The signed-in host's id, if a host is signed in on this device. */
export function currentHostId(): string | null {
    return current?.host.id ?? null;
}

export function useSession(): Session | null | undefined {
    return useSyncExternalStore(
        subscribeSession,
        () => current,
        () => current,
    );
}

/** True when the server ended the session; Welcome shows "You've been signed out" once. */
export function useSignedOutNotice(): boolean {
    return useSyncExternalStore(
        subscribeSession,
        () => signedOut,
        () => signedOut,
    );
}

/** Marks the signed-out notice as seen. */
export function dismissSignedOutNotice(): void {
    if (!signedOut) return;
    signedOut = false;
    for (const listener of listeners) listener();
}

// The server's clock. Each response's `Date` header gives the offset from the device clock, so
// countdowns and the shooting window don't depend on a phone set to the wrong time. Browsers
// only see the header when the API lists it in Access-Control-Expose-Headers.

let clockOffset = 0;

function noteServerTime(response: Response, sentAt: number): void {
    const header = response.headers.get("date");
    const server = header ? Date.parse(header) : NaN;
    if (!Number.isFinite(server)) return;
    const receivedAt = Date.now();
    // The header has whole seconds, so it trails the real time by half a second on average.
    clockOffset = server + 500 - (sentAt + receivedAt) / 2;
}

/** The current time by the server's clock, as far as the last response tells. */
export function serverNow(): Date {
    return new Date(Date.now() + clockOffset);
}

// Requests

const API_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 90_000;

interface RequestOptions<T extends z.ZodType> {
    body?: unknown;
    query?: Record<string, string | undefined>;
    schema: T;
}

/** fetch with a deadline. A request that takes longer fails with "timeout". */
async function fetchWithin(url: string, init: RequestInit, ms: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (controller.signal.aborted) {
            throw new ApiError(0, "timeout", `No response within ${ms / 1000} s.`);
        }
        throw asApiError(error);
    } finally {
        clearTimeout(timer);
    }
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
    if (!text) return { ok: true, value: null };
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch {
        return { ok: false };
    }
}

const ProblemBody = z.object({ code: z.string(), message: z.string() });

async function request<T extends z.ZodType>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    { body, query, schema }: RequestOptions<T>,
): Promise<z.infer<T>> {
    const headers: Record<string, string> = { Accept: "application/json", "X-Device": deviceId() };
    if (current) headers.Authorization = `Bearer ${current.session}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) search.set(key, value);
    }
    const qs = search.size > 0 ? `?${search.toString()}` : "";

    const sentAt = Date.now();
    const response = await fetchWithin(
        `${API_URL}${path}${qs}`,
        { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
        API_TIMEOUT_MS,
    );
    noteServerTime(response, sentAt);

    let text: string;
    try {
        text = await response.text();
    } catch (error) {
        throw asApiError(error);
    }
    const json = parseJson(text);
    if (!response.ok) {
        const problem = json.ok ? ProblemBody.safeParse(json.value) : null;
        const code = problem?.success ? problem.data.code : "http";
        if (
            response.status === 401 &&
            current &&
            path !== "/v1/auth/demo" &&
            code !== "no-device"
        ) {
            // Signing out with a session the server already dropped isn't news to the host.
            signedOut = path !== "/v1/auth/sign-out";
            await saveSession(null);
        }
        throw problem?.success
            ? new ApiError(response.status, code, problem.data.message)
            : new ApiError(response.status, "http", `Request failed with ${response.status}`);
    }
    if (!json.ok) {
        throw new ApiError(response.status, "bad-response", `${path} didn't return JSON.`);
    }
    const parsed = schema.safeParse(json.value);
    if (!parsed.success) {
        throw new ApiError(response.status, "bad-response", `${path}: ${parsed.error.message}`);
    }
    return parsed.data;
}

const EventEnvelope = z.object({ event: Event }).transform((r) => r.event);
const EventsEnvelope = z.object({ events: z.array(Event) }).transform((r) => r.events);
const SummaryEnvelope = z.object({ event: EventSummary }).transform((r) => r.event);
const SummariesEnvelope = z.object({ events: z.array(EventSummary) }).transform((r) => r.events);

export type { Event, EventSummary, Guest, GalleryPage, Person, Shot };

export const api = {
    auth: {
        start: (email: string) =>
            request("POST", "/v1/auth/email/start", { body: { email }, schema: Ok }),
        async verify(email: string, code: string): Promise<Session> {
            const session = await request("POST", "/v1/auth/email/verify", {
                body: { email, code },
                schema: SessionResponse,
            });
            await saveSession(session);
            return session;
        },
        async demo(): Promise<Session> {
            const session = await request("POST", "/v1/auth/demo", { schema: SessionResponse });
            await saveSession(session);
            return session;
        },
        async signOut(): Promise<void> {
            await request("POST", "/v1/auth/sign-out", { schema: Ok }).catch(() => null);
            // The server detached this device's push token from the host; register it afresh.
            storage.remove(PUSH_KEY);
            await saveSession(null);
        },
    },

    me: {
        get: () => request("GET", "/v1/me", { schema: HostEnvelope }),
        /** Changes the name guests see on the join sheet. */
        async rename(name: string): Promise<Host> {
            const host = await request("PATCH", "/v1/me", { body: { name }, schema: HostEnvelope });
            if (current) await saveSession({ ...current, host });
            return host;
        },
        /** Resolves to true once the account and its events are gone. */
        async delete(): Promise<true> {
            const codes = await request("GET", "/v1/events", { schema: EventsEnvelope })
                .then((events) => events.map((event) => event.code))
                .catch(() => []);
            await request("DELETE", "/v1/me", { schema: Ok });
            await forgetEvents(codes);
            await saveSession(null);
            return true;
        },
    },

    events: {
        list: () => request("GET", "/v1/events", { schema: EventsEnvelope }),
        get: (id: string) => request("GET", `/v1/events/${id}`, { schema: EventEnvelope }),
        create: (settings: EventSettings) =>
            request("POST", "/v1/events", { body: settings, schema: EventEnvelope }),
        /** Changes what the event's state still allows; a locked field fails with "locked". */
        update: (id: string, patch: EventSettingsPatch) =>
            request("PATCH", `/v1/events/${id}`, { body: patch, schema: EventEnvelope }),
        /** A signed upload URL for the cover, which must then be PUT with the same type. */
        cover: (id: string, contentType: string) =>
            request("POST", `/v1/events/${id}/cover`, {
                body: { contentType },
                schema: CoverUpload,
            }),
        /** Removes the cover photo. */
        removeCover: (id: string) =>
            request("DELETE", `/v1/events/${id}/cover`, { schema: EventEnvelope }),
        live: (id: string) => request("POST", `/v1/events/${id}/live`, { schema: EventEnvelope }),
        /** Ends a live event now. */
        end: (id: string) => request("POST", `/v1/events/${id}/end`, { schema: EventEnvelope }),
        /** Deletes the event, its photos and its stored files, and clears it from this device. */
        async delete(id: string, code: string): Promise<void> {
            await request("DELETE", `/v1/events/${id}`, { schema: Ok });
            await forgetEvents([code]);
        },
    },

    /** Guest endpoints, addressed by join code. */
    guest: {
        summary: (code: string) => request("GET", `/v1/e/${code}`, { schema: SummaryEnvelope }),
        /** Summaries of every event this device joined, newest first. */
        joined: () => request("GET", "/v1/joined", { schema: SummariesEnvelope }),
        join: (code: string, name: string) =>
            request("POST", `/v1/e/${code}/join`, {
                body: { name, device: deviceId() },
                schema: GuestResponse,
            }),
        me: (code: string) => request("GET", `/v1/e/${code}/me`, { schema: GuestResponse }),
        /** One page of the gallery; `guest` limits it to one person's roll. */
        gallery: (code: string, cursor?: string, guest?: string) =>
            request("GET", `/v1/e/${code}/gallery`, {
                query: { cursor, guest },
                schema: GalleryPage,
            }),
        /** The photos the moment fans out or the recap plays, chosen by the server. */
        highlights: (code: string, purpose: HighlightsFor) =>
            request("GET", `/v1/e/${code}/highlights`, {
                query: { for: purpose },
                schema: Highlights,
            }),
        people: (code: string) =>
            request("GET", `/v1/e/${code}/people`, { schema: PeopleResponse }),
        /**
         * Reserves one shot. `takenAt` is when the shutter fired, for uploads sent later;
         * `clientId` names the photo, so a retry gets the same reservation back.
         */
        reserveShot: (code: string, takenAt: string, clientId: string) =>
            request("POST", `/v1/e/${code}/shots`, {
                body: { takenAt, clientId },
                schema: Reservation,
            }),
        /** Where to send the reveal email for this guest; `null` forgets the address. */
        email: (code: string, email: string | null) =>
            request("POST", `/v1/e/${code}/email`, { body: { email }, schema: EmailResponse }),
        /** Emails a link that moves this guest to another device. */
        sendRestore: (code: string, email: string) =>
            request("POST", `/v1/e/${code}/restore/send`, { body: { email }, schema: Ok }),
        /** Moves the guest named by an email link's token to this device. */
        restore: (code: string, token: string) =>
            request("POST", `/v1/e/${code}/restore`, {
                body: { token, device: deviceId() },
                schema: GuestResponse,
            }),
    },

    shots: {
        confirm: (id: string) =>
            request("POST", `/v1/shots/${id}/confirm`, { schema: ShotEnvelope }),
        like: (id: string) => request("POST", `/v1/shots/${id}/like`, { schema: LikeResponse }),
        report: (id: string) =>
            request("POST", `/v1/shots/${id}/report`, { schema: ReportResponse }),
        hide: (id: string, hidden: boolean) =>
            request("POST", `/v1/shots/${id}/hide`, { body: { hidden }, schema: ShotEnvelope }),
        /** Removes the guest's own photo from the event. */
        remove: (id: string) => request("DELETE", `/v1/shots/${id}`, { schema: Ok }),
    },

    /** Stores an Expo push token for the signed-in host or this device. */
    push: (token: string) => request("POST", "/v1/push", { body: { token }, schema: Ok }),

    billing: {
        /** Verifies one store transaction with RevenueCat and applies it to the event. */
        claim: (eventId: string, productId: string, transactionId: string) =>
            request("POST", "/v1/billing/claim", {
                body: { eventId, productId, transactionId },
                schema: EventEnvelope,
            }),
        /** A Stripe Checkout URL. Stripe returns the host to the event page afterwards. */
        checkout: (eventId: string, tier: TierId, unlimitedShots: boolean) =>
            request("POST", "/v1/billing/checkout", {
                body: { eventId, tier, unlimitedShots },
                schema: Checkout,
            }),
        /** Development only: applies a product without a store. */
        devClaim: (eventId: string, productId: string) =>
            request("POST", "/v1/billing/dev-claim", {
                body: { eventId, productId },
                schema: EventEnvelope,
            }),
    },
};

/** Uploads a local file (a `file://` or `blob:` uri) to a signed storage URL. */
export async function uploadFile(
    uploadUrl: string,
    uri: string,
    contentType: string,
): Promise<void> {
    const blob = await (await fetch(uri)).blob();
    const response = await fetchWithin(
        uploadUrl,
        { method: "PUT", headers: { "Content-Type": contentType }, body: blob },
        UPLOAD_TIMEOUT_MS,
    );
    if (!response.ok) {
        throw new ApiError(response.status, "upload-failed", "The photo didn't upload.");
    }
}

/**
 * When a signed storage URL stops working, in ms since the epoch, read from its
 * `X-Amz-Date` and `X-Amz-Expires`. `null` for a URL that isn't signed that way.
 */
export function signedUrlExpiry(url: string): number | null {
    const query = url.split("?")[1];
    if (!query) return null;
    const params = new URLSearchParams(query);
    const date = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(
        params.get("X-Amz-Date") ?? "",
    );
    const seconds = Number(params.get("X-Amz-Expires"));
    if (!date || !Number.isFinite(seconds)) return null;
    const [, y, mo, d, h, mi, s] = date.map(Number);
    return Date.UTC(y ?? 0, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0, s ?? 0) + seconds * 1000;
}

// Forgetting events on this device: after the host deletes one or their account, nothing about
// it should stay behind. Other modules (the upload queue) register what they keep per event.

const forgetters = new Set<(codes: readonly string[]) => void>();

/** Runs `forget` with the join codes of events this device should drop. */
export function onForgetEvents(forget: (codes: readonly string[]) => void): () => void {
    forgetters.add(forget);
    return () => forgetters.delete(forget);
}

async function forgetEvents(codes: readonly string[]): Promise<void> {
    for (const code of codes) {
        storage.remove(`moment:${code}`);
        storage.remove(`reminder:${code}`);
        forgetCached(`summary:${code}`);
        forgetCached(`me:${code}`);
        if (Platform.OS !== "web") {
            await Notifications.cancelScheduledNotificationAsync(`reveal-${code}`).catch(
                () => null,
            );
        }
    }
    for (const forget of forgetters) forget(codes);
}

// The query cache. Screens load through `useLoad` with a key such as `summary:<code>`; every
// screen using that key shares one copy, a fresh copy is reused instead of fetched again, and
// a stale one shows at once while it reloads. Summaries and `me` are kept on the device, so the
// camera and the event open offline.

/** Data younger than this is reused without a request. */
const FRESH_MS = 30_000;
const PERSISTED = /^(summary|me):/;
const persistKey = (key: string) => `cache:${key}`;

interface Entry {
    data: unknown;
    /** 0 when nothing has loaded yet. */
    loadedAt: number;
    error: ApiError | null;
    loading: boolean;
}

const EMPTY_ENTRY: Entry = { data: undefined, loadedAt: 0, error: null, loading: false };
const entries = new Map<string, Entry>();
const keyListeners = new Map<string, Set<() => void>>();
const loaders = new Map<string, () => Promise<unknown>>();
const inFlight = new Map<string, Promise<void>>();
/** How many mounted screens use each key, for refetching on returning to the app. */
const users = new Map<string, number>();

function entryOf(key: string): Entry {
    const known = entries.get(key);
    if (known) return known;
    let entry = EMPTY_ENTRY;
    if (PERSISTED.test(key)) {
        try {
            const raw = storage.getString(persistKey(key));
            // A kept copy shows at once and is always refetched, so it counts as old.
            if (raw) entry = { ...EMPTY_ENTRY, data: JSON.parse(raw), loadedAt: 1 };
        } catch {
            entry = EMPTY_ENTRY;
        }
    }
    entries.set(key, entry);
    return entry;
}

function setEntry(key: string, patch: Partial<Entry>): void {
    entries.set(key, { ...entryOf(key), ...patch });
    if (patch.data !== undefined && PERSISTED.test(key)) {
        try {
            storage.set(persistKey(key), JSON.stringify(patch.data));
        } catch {
            // Browser storage can be full; the copy in memory still works for this visit.
        }
    }
    for (const listener of keyListeners.get(key) ?? []) listener();
}

function fetchKey(key: string): Promise<void> {
    const running = inFlight.get(key);
    if (running) return running;
    const load = loaders.get(key);
    if (!load) return Promise.resolve();
    setEntry(key, { loading: true, error: null });
    const run = load()
        .then(
            (data) => setEntry(key, { data, loadedAt: Date.now(), error: null, loading: false }),
            (error: unknown) => setEntry(key, { error: asApiError(error), loading: false }),
        )
        .finally(() => inFlight.delete(key));
    inFlight.set(key, run);
    return run;
}

function refreshIfOld(key: string): void {
    if (Date.now() - entryOf(key).loadedAt >= FRESH_MS) fetchKey(key).catch(() => null);
}

/** What the cache holds for a key, without loading it. */
export function cached<T>(key: string): T | undefined {
    return entryOf(key).data as T | undefined;
}

/** Puts data the app already has into the cache, such as `me` after joining. */
export function setCached<T>(key: string, data: T): void {
    setEntry(key, { data, loadedAt: Date.now(), error: null });
}

/** Reloads every key that starts with `prefix` now if a screen shows it, otherwise next time. */
export function invalidate(prefix: string): void {
    for (const key of entries.keys()) {
        if (!key.startsWith(prefix)) continue;
        if ((users.get(key) ?? 0) > 0) fetchKey(key).catch(() => null);
        else setEntry(key, { loadedAt: Math.min(entryOf(key).loadedAt, 1) });
    }
}

/** Drops a key from memory and from the device. */
export function forgetCached(key: string): void {
    entries.delete(key);
    storage.remove(persistKey(key));
    for (const listener of keyListeners.get(key) ?? []) listener();
}

AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    for (const [key, count] of users) if (count > 0) fetchKey(key).catch(() => null);
});

/** Runs `callback` each time the app comes back to the foreground. */
export function useOnForeground(callback: () => void): void {
    const run = useEffectEvent(callback);
    useEffect(() => {
        const subscription = AppState.addEventListener("change", (state) => {
            if (state === "active") run();
        });
        return () => subscription.remove();
    }, []);
}

export interface Loaded<T> {
    data: T | undefined;
    error: ApiError | null;
    loading: boolean;
    reload: () => void;
}

export interface LoadOptions {
    /** Reloads this often while the screen is shown and the app is in the foreground. */
    intervalMs?: number | null;
}

/**
 * Loads data for a key through the shared cache. A `null` key waits. Cached data, from this
 * visit or kept on the device, shows at once while a fresh copy loads; the key reloads when the
 * screen comes back into focus and when the app returns to the foreground.
 */
export function useLoad<T>(
    key: string | null,
    load: () => Promise<T>,
    { intervalMs = null }: LoadOptions = {},
): Loaded<T> {
    const run = useEffectEvent(load);
    const subscribe = useCallback(
        (listener: () => void) => {
            if (key === null) return () => undefined;
            const set = keyListeners.get(key) ?? new Set<() => void>();
            keyListeners.set(key, set);
            set.add(listener);
            return () => {
                set.delete(listener);
            };
        },
        [key],
    );
    const entry = useSyncExternalStore(
        subscribe,
        () => (key === null ? EMPTY_ENTRY : entryOf(key)),
        () => (key === null ? EMPTY_ENTRY : entryOf(key)),
    );

    useEffect(() => {
        if (key === null) return;
        loaders.set(key, () => run());
        users.set(key, (users.get(key) ?? 0) + 1);
        refreshIfOld(key);
        return () => {
            users.set(key, Math.max(0, (users.get(key) ?? 1) - 1));
        };
    }, [key]);

    useFocusEffect(
        useCallback(() => {
            if (key !== null) refreshIfOld(key);
        }, [key]),
    );

    useEffect(() => {
        if (key === null || !intervalMs) return;
        const id = setInterval(() => {
            if (AppState.currentState === "active") fetchKey(key).catch(() => null);
        }, intervalMs);
        return () => clearInterval(id);
    }, [key, intervalMs]);

    // A screen whose key changes keeps showing what it had until the new key loads.
    const [previous, setPrevious] = useState<unknown>(undefined);
    if (entry.data !== undefined && entry.data !== previous) setPrevious(entry.data);

    return {
        data: (entry.data ?? previous) as T | undefined,
        error: entry.error,
        loading: key !== null && (entry.loading || (entry.loadedAt === 0 && !entry.error)),
        reload: () => {
            if (key !== null) fetchKey(key).catch(() => null);
        },
    };
}

export interface Action<A extends unknown[], R> {
    /** Runs the action. Resolves to the result, or `undefined` when it failed. Never rejects. */
    run: (...args: A) => Promise<R | undefined>;
    busy: boolean;
    error: ApiError | null;
    reset: () => void;
}

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>): Action<A, R> {
    const [state, setState] = useState<{ busy: boolean; error: ApiError | null }>({
        busy: false,
        error: null,
    });
    return {
        ...state,
        async run(...args) {
            setState({ busy: true, error: null });
            try {
                const result = await fn(...args);
                setState({ busy: false, error: null });
                return result;
            } catch (error) {
                setState({ busy: false, error: asApiError(error) });
                return undefined;
            }
        },
        reset: () => setState({ busy: false, error: null }),
    };
}
