import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { EventSettings } from "@linger/core/events";
import sharp from "sharp";
import { createSession, findOrCreateHost } from "./accounts.ts";
import { migrate, sql } from "./db.ts";
import { createApp } from "./server.ts";
import { removePrefix } from "./storage.ts";

/**
 * Shared by the integration tests, and their global setup: each run starts from an empty test
 * database and an empty test bucket.
 */
export default async function setup(): Promise<() => Promise<void>> {
    await sql.unsafe(`
        drop schema if exists public cascade;
        drop schema if exists drizzle cascade;
        drop schema if exists pgboss cascade;
        create schema public;
    `);
    await migrate();
    await removePrefix("");
    return async () => {
        await sql.end({ timeout: 5 });
    };
}

export const app = createApp();

/** A parsed JSON reply, loosely typed so tests can reach into any route's shape. */
export type Loose = { readonly [key: string]: Loose } & { readonly [index: number]: Loose };

export interface Reply {
    status: number;
    body: Loose;
}

export async function call(
    method: string,
    path: string,
    options: {
        token?: string;
        device?: string;
        json?: unknown;
        headers?: Record<string, string>;
    } = {},
): Promise<Reply> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.device) headers["x-device"] = options.device;
    let body: string | undefined;
    if (options.json !== undefined && method !== "GET") {
        headers["content-type"] = "application/json";
        body = JSON.stringify(options.json);
    }
    const res = await app.request(path, { method, headers, ...(body ? { body } : {}) });
    const text = await res.text();
    let parsed: unknown;
    try {
        parsed = text ? JSON.parse(text) : {};
    } catch {
        parsed = { text };
    }
    return { status: res.status, body: parsed as Loose };
}

export function newDevice(): string {
    return randomBytes(12).toString("base64url");
}

export async function newHost(name = "Test Host"): Promise<{ token: string; hostId: string }> {
    const email = `host-${randomBytes(6).toString("hex")}@example.com`;
    const host = await findOrCreateHost(email, name);
    return { token: await createSession(host.id), hostId: host.id };
}

export function settings(overrides: Partial<EventSettings> = {}): EventSettings {
    const now = Date.now();
    return {
        occasion: "party",
        title: "Test party",
        startsAt: new Date(now - 3_600_000).toISOString(),
        endsAt: new Date(now + 2 * 3_600_000).toISOString(),
        timeZone: "America/Vancouver",
        revealMode: "at-end",
        shotsPerGuest: 5,
        visibility: "everyone",
        look: "warm-98@1",
        ...overrides,
    };
}

/** A draft, or a live event when `live` is set, owned by the given host. */
export async function newEvent(
    token: string,
    options: { live?: boolean; settings?: Partial<EventSettings> } = {},
): Promise<{ id: string; code: string }> {
    const created = await call("POST", "/v1/events", { token, json: settings(options.settings) });
    if (created.status !== 201) throw new Error(JSON.stringify(created.body));
    const event = { id: String(created.body.event?.id), code: String(created.body.event?.code) };
    if (options.live) {
        const live = await call("POST", `/v1/events/${event.id}/live`, { token });
        if (live.status !== 200) throw new Error(JSON.stringify(live.body));
    }
    return event;
}

export async function join(
    code: string,
    name = "Guest",
): Promise<{ device: string; guestId: string }> {
    const device = newDevice();
    const res = await call("POST", `/v1/e/${code}/join`, { json: { name, device } });
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    return { device, guestId: String(res.body.guest?.id) };
}

let sample: Buffer | null = null;

/** A small real photo for uploads. */
export async function samplePhoto(): Promise<Buffer> {
    sample ??= await sharp(
        await readFile(new URL("../../app/assets/demo/b-cake.jpg", import.meta.url)),
    )
        .resize(640)
        .jpeg()
        .toBuffer();
    return sample;
}

export async function upload(url: string, data: Buffer): Promise<number> {
    const res = await fetch(url, {
        method: "PUT",
        body: new Uint8Array(data),
        headers: { "content-type": "image/jpeg" },
    });
    return res.status;
}

/** Reserves, uploads and confirms one shot; returns its id. */
export async function shoot(code: string, device: string): Promise<string> {
    const reserved = await call("POST", `/v1/e/${code}/shots`, { device });
    if (reserved.status !== 201) throw new Error(JSON.stringify(reserved.body));
    const status = await upload(String(reserved.body.uploadUrl), await samplePhoto());
    if (status !== 200) throw new Error(`upload failed with ${status}`);
    const shotId = String(reserved.body.shotId);
    const confirmed = await call("POST", `/v1/shots/${shotId}/confirm`, { device });
    if (confirmed.status !== 200) throw new Error(JSON.stringify(confirmed.body));
    return shotId;
}

export async function waitFor<T>(
    check: () => Promise<T | null | undefined | false>,
    timeoutMs = 20_000,
): Promise<T> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        const value = await check();
        if (value) return value;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("Timed out waiting");
}
