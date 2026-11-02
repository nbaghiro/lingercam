import { Event, EventSummary, Guest, type EventSettings } from "@linger/core/events";
import type { TierId } from "@linger/core/pricing";
import { GalleryPage, Shot } from "@linger/core/shots";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";
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

const GuestResponse = z.object({ guest: Guest, shotsLeft: z.number().int().nullable() });

export const Person = z.object({
    id: z.string(),
    name: z.string(),
    shots: z.number().int(),
    joinedAt: z.string(),
});
export type Person = z.infer<typeof Person>;

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

/** An error the API reported as `{ code, message }`, or "network" when it could not be reached. */
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

/** A random id made on first launch. Guests are known to an event by this id. */
export function deviceId(): string {
    let id = storage.getString(DEVICE_KEY);
    if (!id) {
        id = randomUUID();
        storage.set(DEVICE_KEY, id);
    }
    return id;
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
const listeners = new Set<() => void>();

function publish(next: Session | null): void {
    current = next;
    for (const listener of listeners) listener();
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
        (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        () => current,
        () => current,
    );
}

// Requests

interface RequestOptions<T extends z.ZodType> {
    body?: unknown;
    query?: Record<string, string | undefined>;
    schema: T;
}

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

    let response: Response;
    try {
        response = await fetch(`${API_URL}${path}${qs}`, {
            method,
            headers,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
    } catch (error) {
        throw asApiError(error);
    }

    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) {
        const problem = z.object({ code: z.string(), message: z.string() }).safeParse(json);
        if (response.status === 401 && current && path !== "/v1/auth/demo") {
            await saveSession(null);
        }
        throw problem.success
            ? new ApiError(response.status, problem.data.code, problem.data.message)
            : new ApiError(response.status, "http", `Request failed with ${response.status}`);
    }
    return schema.parse(json);
}

const EventEnvelope = z.object({ event: Event }).transform((r) => r.event);
const EventsEnvelope = z.object({ events: z.array(Event) }).transform((r) => r.events);
const SummaryEnvelope = z.object({ event: EventSummary }).transform((r) => r.event);

export type { Event, EventSummary, Guest, GalleryPage, Shot };

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
        /** Resolves to true once the account and its events are gone. */
        async delete(): Promise<true> {
            await request("DELETE", "/v1/me", { schema: Ok });
            await saveSession(null);
            return true;
        },
    },

    events: {
        list: () => request("GET", "/v1/events", { schema: EventsEnvelope }),
        get: (id: string) => request("GET", `/v1/events/${id}`, { schema: EventEnvelope }),
        create: (settings: EventSettings) =>
            request("POST", "/v1/events", { body: settings, schema: EventEnvelope }),
        /** A signed upload URL for the cover, which must then be PUT with the same type. */
        cover: (id: string, contentType: string) =>
            request("POST", `/v1/events/${id}/cover`, {
                body: { contentType },
                schema: CoverUpload,
            }),
        live: (id: string) => request("POST", `/v1/events/${id}/live`, { schema: EventEnvelope }),
    },

    /** Guest endpoints, addressed by join code. */
    guest: {
        summary: (code: string) => request("GET", `/v1/e/${code}`, { schema: SummaryEnvelope }),
        join: (code: string, name: string) =>
            request("POST", `/v1/e/${code}/join`, {
                body: { name, device: deviceId() },
                schema: GuestResponse,
            }),
        me: (code: string) => request("GET", `/v1/e/${code}/me`, { schema: GuestResponse }),
        gallery: (code: string, cursor?: string) =>
            request("GET", `/v1/e/${code}/gallery`, { query: { cursor }, schema: GalleryPage }),
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
    },

    shots: {
        confirm: (id: string) =>
            request("POST", `/v1/shots/${id}/confirm`, { schema: ShotEnvelope }),
        like: (id: string) => request("POST", `/v1/shots/${id}/like`, { schema: LikeResponse }),
        report: (id: string) =>
            request("POST", `/v1/shots/${id}/report`, { schema: ReportResponse }),
        hide: (id: string, hidden: boolean) =>
            request("POST", `/v1/shots/${id}/hide`, { body: { hidden }, schema: ShotEnvelope }),
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
    const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: blob,
    });
    if (!response.ok) {
        throw new ApiError(response.status, "upload-failed", "The photo didn't upload.");
    }
}

// Hooks

export interface Loaded<T> {
    data: T | undefined;
    error: ApiError | null;
    loading: boolean;
    reload: () => void;
}

/**
 * Loads data for a key and reloads when the key changes. A `null` key waits. Data from the
 * previous load stays available while the next one runs.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
    const [nonce, setNonce] = useState(0);
    const [result, setResult] = useState<{ for: string; data?: T; error: ApiError | null }>({
        for: "",
        error: null,
    });
    const target = key === null ? null : `${key}#${nonce}`;
    const run = useEffectEvent(load);

    useEffect(() => {
        if (target === null) return;
        let live = true;
        run().then(
            (data) => {
                if (live) setResult({ for: target, data, error: null });
            },
            (error: unknown) => {
                if (live) setResult((prev) => ({ ...prev, for: target, error: asApiError(error) }));
            },
        );
        return () => {
            live = false;
        };
    }, [target]);

    return {
        data: result.data,
        error: result.for === target ? result.error : null,
        loading: target !== null && result.for !== target,
        reload: () => setNonce((n) => n + 1),
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
