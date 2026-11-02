import { normalizeJoinCode } from "@linger/core/events";
import { DEFAULT_LOOK, type LookId } from "@linger/core/film";
import { shootingPhase, type ShootingPhase } from "@linger/core/shots";
import { useNetInfo } from "@react-native-community/netinfo";
import { File } from "expo-file-system";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
    FadeIn,
    FadeOut,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { closeActivity, trackShot } from "@/activity";
import {
    api,
    invalidate,
    onForgetEvents,
    serverNow,
    storage,
    useLoad,
    useOnForeground,
    type ApiError,
    type EventSummary,
} from "@/api";
import { formatDuration, formatTime, revealWhen, t } from "@/copy";
import { InviteSheet } from "@/invite";
import { LookImage } from "@/look";
import {
    Button,
    CHROME_SCALE,
    Icon,
    IconButton,
    Mark,
    Text,
    color,
    haptic,
    icons,
    useReduceMotion,
} from "@/ui";
import { enqueue, setShotsLeft, useShots, type ShotsState } from "@/uploads";

// The camera screen's frame, shared by the native camera (camera.tsx) and the browser camera
// (camera.web.tsx). Each supplies a Lens: the live view and a way to take a photo.

export type FlashMode = "auto" | "on" | "off";

export interface Capture {
    /** The photo, kept where the upload queue can find it after a restart. */
    uri: string;
    /** A small copy for the last-shot thumbnail, so it never decodes the full photo. */
    thumb: string;
}

export interface Lens {
    /** Drawn inside the rounded viewfinder. */
    view: ReactNode;
    /** Takes a photo with the chosen flash. */
    capture: (flash: FlashMode) => Promise<Capture>;
    /** A real flash on the back camera, the screen as a flash on the front one, or none. */
    flash: "flash" | "screen" | "none";
    /** The 0.5 lens, where the device has an ultra wide camera. */
    zoom: { wide: boolean; available: boolean; set: (wide: boolean) => void };
    flip: { available: boolean; run: () => void };
    /** Sample photos stand in for a camera. */
    demo: boolean;
    /** Something stops the camera, such as a refused permission, with a way to fix it. */
    blocked: { message: string; action?: { label: string; run: () => void } } | null;
}

export interface CameraEvent {
    code: string;
    summary: EventSummary | undefined;
    error: ApiError | null;
    reload: () => void;
    shots: ShotsState;
    look: LookId;
    now: Date;
}

/** Ticks often enough for minute countdowns, and lands exactly on each boundary given. */
const TICK_MS = 15_000;
/** "Closes in 8 min" shows under this. */
const CLOSING_SOON_MS = 10 * 60_000;
/** The summary reloads this often while the camera is open, so End now reaches it. */
const SUMMARY_POLL_MS = 60_000;

/**
 * The server's time, rendered again at each of `marks` (ms since the epoch) and every 15 s, so a
 * screen switches state the moment the start, the end or the reveal passes.
 */
export function useEventClock(marks: readonly number[]): Date {
    const [now, setNow] = useState(serverNow);
    const key = marks.join(",");
    useEffect(() => {
        const current = serverNow().getTime();
        const upcoming = key
            .split(",")
            .map(Number)
            .filter((mark) => Number.isFinite(mark) && mark > current);
        const next = Math.min(current + TICK_MS, ...upcoming);
        const id = setTimeout(() => setNow(serverNow()), Math.max(50, next - current + 20));
        return () => clearTimeout(id);
    }, [now, key]);
    useOnForeground(() => setNow(serverNow()));
    return now;
}

/** The moments a camera or join sheet changes state. */
export function eventMarks(summary: EventSummary | undefined): number[] {
    if (!summary) return [];
    const endsAt = Date.parse(summary.endsAt);
    return [Date.parse(summary.startsAt), endsAt - CLOSING_SOON_MS, endsAt, revealsAt(summary)];
}

const revealsAt = (summary: EventSummary) => Date.parse(summary.revealsAt);

/** True once the photos are out, by the clock or by the server's state. */
export function isRevealed(summary: EventSummary, now: Date): boolean {
    return (
        summary.state === "revealed" ||
        summary.state === "archived" ||
        (summary.state !== "draft" && now.getTime() >= revealsAt(summary))
    );
}

/** The device knew this event, but the server no longer has it: the host deleted it. */
export function isGone(data: unknown, error: ApiError | null): boolean {
    return data !== undefined && (error?.code === "not-found" || error?.code === "gone");
}

// Flash mode is remembered per device.

const FLASH_KEY = "flashMode";

function readFlash(): FlashMode {
    const saved = storage.getString(FLASH_KEY);
    return saved === "on" || saved === "off" ? saved : "auto";
}

const NEXT_FLASH: Record<FlashMode, FlashMode> = { auto: "on", on: "off", off: "auto" };

// The last shot per event, so it is still there when the camera opens again.

const lastKey = (code: string) => `lastShot:${code}`;

/** Deletes a thumbnail the app made on the device. Web thumbnails are data URLs. */
function forgetThumb(uri: string): void {
    if (!uri.startsWith("file:") || !uri.includes("/thumbs/")) return;
    try {
        const file = new File(uri);
        if (file.exists) file.delete();
    } catch {
        // A leftover thumbnail in the app's documents is harmless.
    }
}

onForgetEvents((codes) => {
    for (const code of codes) {
        const thumb = storage.getString(lastKey(code));
        if (thumb) forgetThumb(thumb);
        storage.remove(lastKey(code));
    }
});

/** Loads the event and this guest, and sends anyone who hasn't joined to the join sheet. */
export function useCameraEvent(): CameraEvent {
    const params = useLocalSearchParams<{ code: string }>();
    const code = normalizeJoinCode(params.code ?? "") ?? params.code ?? "";
    const router = useRouter();
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code), {
        intervalMs: SUMMARY_POLL_MS,
    });
    const me = useLoad(`me:${code}`, () => api.guest.me(code));
    const shots = useShots(code);
    const now = useEventClock(eventMarks(summary.data));

    useEffect(() => {
        if (me.data) setShotsLeft(code, me.data.shotsLeft);
    }, [code, me.data]);

    useEffect(() => {
        if (me.error?.code === "not-joined") router.replace(`/j/${code}` as Href);
    }, [code, me.error, router]);

    // A photo refused for good usually means the camera closed early, so check at once.
    // Whether it was lost, saved to Photos or is waiting to be saved, it counts.
    const refused = shots.failed + shots.keptInPhotos + shots.refused;
    const lastRefused = useRef(refused);
    useEffect(() => {
        if (refused > lastRefused.current) invalidate(`summary:${code}`);
        lastRefused.current = refused;
    }, [code, refused]);

    return {
        code,
        summary: summary.data,
        error: summary.error,
        reload: summary.reload,
        shots,
        look: summary.data?.look ?? DEFAULT_LOOK,
        now,
    };
}

/** Keeps the screen on while the camera is open. The browser drops its lock on a hidden tab. */
function useStayAwake(): void {
    const [visits, setVisits] = useState(0);
    useOnForeground(() => setVisits((n) => n + 1));
    useEffect(() => {
        const tag = `camera-${visits}`;
        activateKeepAwakeAsync(tag).catch(() => null);
        return () => {
            deactivateKeepAwake(tag).catch(() => null);
        };
    }, [visits]);
}

function after(ms: number, run: () => void): void {
    setTimeout(run, ms);
}

export function CameraFrame({ event, lens }: { event: CameraEvent; lens: Lens }) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReduceMotion();
    const net = useNetInfo();
    const { code, summary, shots, now } = event;
    const [last, setLast] = useState<string | null>(() => storage.getString(lastKey(code)) ?? null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(0);
    const [inviting, setInviting] = useState(false);
    const [flash, setFlash] = useState<FlashMode>(readFlash);
    const [screenFlash, setScreenFlash] = useState(false);
    const blink = useSharedValue(0);
    const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
    useStayAwake();

    const gone = isGone(summary, event.error);
    const phase: ShootingPhase | null = summary ? shootingPhase(summary, now) : null;
    const open = phase === "open" && !gone;
    const revealed = summary !== undefined && isRevealed(summary, now);
    const endsIn = summary ? Date.parse(summary.endsAt) - now.getTime() : 0;
    const out = shots.left === 0;
    const loadingShots = shots.left === undefined;
    const offline =
        net.isConnected === false ||
        (summary !== undefined &&
            (event.error?.code === "network" || event.error?.code === "timeout"));

    useEffect(() => {
        if (!failed) return;
        const id = setTimeout(() => setFailed(0), 3000);
        return () => clearTimeout(id);
    }, [failed]);

    // The Live Activity's job is the shooting window, so it closes with the camera.
    const closedOnce = useRef(false);
    useEffect(() => {
        if (summary && phase === "closed" && !closedOnce.current) {
            closedOnce.current = true;
            closeActivity(summary).catch(() => null);
        }
    }, [phase, summary]);

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace(`/e/${code}` as Href);
    };

    const cycleFlash = () => {
        const next = NEXT_FLASH[flash];
        haptic("selection");
        setFlash(next);
        storage.set(FLASH_KEY, next);
    };

    const shoot = async () => {
        if (busy || !open || out || loadingShots || lens.blocked) return;
        setBusy(true);
        setFailed(0);
        haptic("medium");
        after(120, () => haptic("light"));
        if (reduceMotion) {
            blink.set(
                withSequence(withTiming(0.4, { duration: 0 }), withTiming(0, { duration: 260 })),
            );
        } else {
            blink.set(
                withSequence(withTiming(0.85, { duration: 60 }), withTiming(0, { duration: 260 })),
            );
        }
        const lit = lens.flash === "screen" && flash === "on";
        if (lit) {
            setScreenFlash(true);
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        const takenAt = serverNow();
        try {
            const shot = await lens.capture(lens.flash === "flash" ? flash : "off");
            enqueue(code, shot.uri, takenAt);
            if (last) forgetThumb(last);
            setLast(shot.thumb);
            storage.set(lastKey(code), shot.thumb);
            if (shots.left !== undefined) {
                const left = shots.left === null ? null : Math.max(0, shots.left - 1);
                if (left === 0) {
                    after(240, () => haptic("warning"));
                    after(600, () => haptic("success"));
                } else if (left !== null && left <= 3) {
                    after(240, () => haptic("light"));
                }
                // The web reads the counter's live region instead.
                if (Platform.OS !== "web") {
                    AccessibilityInfo.announceForAccessibility(
                        left === null
                            ? t("camera.unlimited")
                            : t("camera.shotsLeft", { count: left }),
                    );
                }
                if (summary) trackShot(summary, left).catch(() => null);
            }
        } catch {
            setFailed(Date.now());
        } finally {
            setScreenFlash(false);
            setBusy(false);
        }
    };

    let topLine = " ";
    if (offline && summary) topLine = t("camera.offline");
    else if (phase === "before" && summary) {
        topLine = t("camera.opensIn", {
            time: formatDuration(Date.parse(summary.startsAt) - now.getTime()),
        });
    } else if (open && endsIn < CLOSING_SOON_MS) {
        topLine = t("camera.closesIn", { minutes: Math.max(1, Math.ceil(endsIn / 60_000)) });
    } else if (open) topLine = t("camera.left", { time: formatDuration(endsIn) });

    let cover: ReactNode = null;
    if (gone) {
        cover = (
            <Cover>
                <Text variant="title" align="center">
                    {t("event.gone")}
                </Text>
                <Button
                    label={t("event.backToEvents")}
                    variant="glass"
                    onPress={() => router.replace("/" as Href)}
                />
            </Cover>
        );
    } else if (!summary && event.error) {
        cover = (
            <Cover>
                <Text variant="title" align="center">
                    {t("join.offlineTitle")}
                </Text>
                <Text variant="small" tone="soft" align="center">
                    {t("join.offlineBody")}
                </Text>
                <Button label={t("common.retry")} variant="glass" onPress={event.reload} />
            </Cover>
        );
    } else if (summary && phase === "before") {
        cover = (
            <Cover>
                <Text variant="title" align="center">
                    {t("camera.opensAt", {
                        time: formatTime(new Date(summary.startsAt), summary.timeZone),
                    })}
                </Text>
                <Button label={t("camera.seeEvent")} variant="glass" onPress={leave} />
            </Cover>
        );
    } else if (summary && phase === "closed" && revealed) {
        cover = (
            <Cover>
                <Text variant="title" align="center">
                    {t("camera.readyTitle")}
                </Text>
                <Button label={t("camera.seePhotos")} variant="glass" onPress={leave} />
            </Cover>
        );
    } else if (summary && phase === "closed") {
        cover = (
            <Cover>
                <Text variant="title" align="center">
                    {t("camera.closed", { when: whenPhrase(summary, now) })}
                </Text>
                <Button label={t("camera.seeEvent")} variant="glass" onPress={leave} />
            </Cover>
        );
    } else if (out && open) {
        cover = (
            <Cover>
                <Text variant="title" align="center">
                    {t("camera.out")}
                </Text>
                <Text variant="small" tone="soft" align="center">
                    {t("camera.outBody", { when: whenPhrase(summary, now) })}
                </Text>
                <Button label={t("camera.seeEvent")} variant="glass" onPress={leave} />
            </Cover>
        );
    } else if (lens.blocked) {
        cover = (
            <Cover>
                <Text variant="small" tone="soft" align="center">
                    {lens.blocked.message}
                </Text>
                {lens.blocked.action ? (
                    <Button
                        label={lens.blocked.action.label}
                        variant="glass"
                        onPress={lens.blocked.action.run}
                    />
                ) : null}
            </Cover>
        );
    }

    const sending = shots.pending > 0;
    const shutterOff = !open || out || busy || loadingShots || lens.blocked !== null;
    const flashLabel = t(
        flash === "auto"
            ? "camera.flashAuto"
            : flash === "on"
              ? "camera.flashOnValue"
              : "camera.flashOffValue",
    );
    const flashOn = lens.flash !== "none" && flash !== "off";

    return (
        <View style={styles.screen}>
            <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
                <IconButton
                    icon={icons.back}
                    onPress={leave}
                    accessibilityLabel={t("common.back")}
                />
                <View style={styles.title}>
                    <Text variant="name" align="center" numberOfLines={1} maxScale={CHROME_SCALE}>
                        {summary?.title ?? " "}
                    </Text>
                    <Text
                        variant="caption"
                        tone={offline ? "candle" : "ash"}
                        align="center"
                        numberOfLines={1}
                        maxScale={CHROME_SCALE}
                    >
                        {topLine}
                    </Text>
                </View>
                <IconButton
                    icon={icons.qr}
                    onPress={() => setInviting(true)}
                    accessibilityLabel={t("event.showCode")}
                    disabled={!summary || gone}
                />
            </View>

            <View style={styles.viewfinder}>
                {lens.view}
                <Animated.View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        reduceMotion ? styles.dim : styles.blink,
                        blinkStyle,
                    ]}
                />
                {lens.demo && open ? (
                    <View style={styles.demo} pointerEvents="none">
                        <Text variant="caption" tone="soft" align="center">
                            {t("camera.usingSamples")}
                        </Text>
                    </View>
                ) : null}
                {failed ? (
                    <Animated.View
                        key={failed}
                        entering={FadeIn.duration(180)}
                        exiting={FadeOut.duration(300)}
                        style={styles.failed}
                        pointerEvents="none"
                    >
                        <Text
                            variant="caption"
                            tone="paper"
                            align="center"
                            accessibilityRole="alert"
                            accessibilityLiveRegion="polite"
                        >
                            {t("camera.failed")}
                        </Text>
                    </Animated.View>
                ) : null}
                {cover}
            </View>

            <View style={styles.tools}>
                <Pressable
                    onPress={cycleFlash}
                    disabled={lens.flash === "none"}
                    accessibilityRole="button"
                    accessibilityLabel={t("camera.flash")}
                    accessibilityValue={{ text: flashLabel }}
                    accessibilityState={{ disabled: lens.flash === "none" }}
                    hitSlop={12}
                    style={[styles.flash, { opacity: lens.flash === "none" ? 0.35 : 1 }]}
                >
                    <Icon
                        icon={flashOn ? icons.flashOn : icons.flashOff}
                        size={23}
                        color={flash === "on" && lens.flash !== "none" ? color.candle : TOOL}
                        {...(flash === "on" ? { weight: "fill" as const } : {})}
                    />
                    {flash === "auto" && lens.flash !== "none" ? (
                        <Text variant="caption" style={styles.flashAuto} maxScale={CHROME_SCALE}>
                            {flashLabel}
                        </Text>
                    ) : null}
                </Pressable>
                <Zoom zoom={lens.zoom} />
                <Pressable
                    onPress={lens.flip.run}
                    disabled={!lens.flip.available}
                    accessibilityRole="button"
                    accessibilityLabel={t("camera.flip")}
                    hitSlop={12}
                    style={{ opacity: lens.flip.available ? 1 : 0.35 }}
                >
                    <Icon icon={icons.flip} size={23} color={TOOL} />
                </Pressable>
            </View>

            <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
                <Counter left={shots.left} allowance={summary?.shotsPerGuest ?? null} />
                <Pressable
                    onPress={() => {
                        shoot().catch(() => null);
                    }}
                    disabled={shutterOff}
                    accessibilityRole="button"
                    accessibilityLabel={t("camera.shutter")}
                    accessibilityState={{ disabled: shutterOff }}
                    style={({ pressed }) => [
                        styles.shutter,
                        { transform: [{ scale: pressed ? 0.94 : 1 }] },
                    ]}
                >
                    {({ pressed }) => (
                        <View
                            style={[
                                styles.shutterIn,
                                pressed || busy ? { backgroundColor: color.rule } : null,
                                shutterOff && !busy ? { opacity: 0.5 } : null,
                            ]}
                        />
                    )}
                </Pressable>
                <Pressable
                    onPress={leave}
                    accessibilityRole="button"
                    accessibilityLabel={
                        sending
                            ? t("camera.lastSending", { count: shots.pending })
                            : last
                              ? t("camera.lastShot")
                              : t("camera.noLastShot")
                    }
                    style={[styles.last, sending ? styles.lastSending : null]}
                >
                    {last ? (
                        <LookImage
                            source={last}
                            look={event.look}
                            style={StyleSheet.absoluteFill}
                        />
                    ) : (
                        <View style={styles.lastEmpty}>
                            <Mark size={22} tint={color.faint} />
                        </View>
                    )}
                </Pressable>
            </View>

            {screenFlash ? (
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.screenFlash]} />
            ) : null}

            {summary && !gone ? (
                <InviteSheet
                    visible={inviting}
                    onClose={() => setInviting(false)}
                    code={code}
                    title={summary.title}
                />
            ) : null}
        </View>
    );
}

const TOOL = "#DDDDDD";

function whenPhrase(summary: EventSummary | undefined, now: Date): string {
    if (!summary) return "";
    const at = new Date(summary.revealsAt);
    return revealWhen(now, at, summary.timeZone);
}

function Cover({ children }: { children: ReactNode }) {
    return (
        <View style={[StyleSheet.absoluteFill, styles.cover]}>
            <View style={{ gap: 16, alignItems: "stretch", width: "100%" }}>{children}</View>
        </View>
    );
}

function Zoom({ zoom }: { zoom: Lens["zoom"] }) {
    // One lens has nothing to choose between, so the pill isn't drawn at all.
    if (!zoom.available) return <View style={styles.zoomSpace} />;
    return (
        <View style={styles.zoom} accessibilityRole="radiogroup">
            {(
                [
                    [true, "0.5"],
                    [false, "1×"],
                ] as const
            ).map(([wide, label]) => {
                const on = zoom.wide === wide;
                return (
                    <Pressable
                        key={label}
                        onPress={() => {
                            if (!on) haptic("selection");
                            zoom.set(wide);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={t("camera.zoom", { level: label })}
                        style={[styles.zoomStop, on ? styles.zoomOn : null]}
                    >
                        <Text
                            variant="caption"
                            style={[styles.zoomText, { color: on ? color.white : color.ash }]}
                            maxScale={CHROME_SCALE}
                        >
                            {label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

/** Shots left with Candle marking the last three. */
const LAST_SHOTS = 3;

/** The shots left, with its neighbours either side, rolling over as each photo is taken. */
function Counter({
    left,
    allowance,
}: {
    left: number | null | undefined;
    allowance: number | null;
}) {
    const reduceMotion = useReduceMotion();
    const shift = useSharedValue(0);
    const previous = useRef(left);
    const rolling = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

    useEffect(() => {
        if (typeof left === "number" && typeof previous.current === "number") {
            if (left !== previous.current && !reduceMotion) {
                shift.set(left < previous.current ? -22 : 22);
                shift.set(withTiming(0, { duration: 260 }));
            }
        }
        previous.current = left;
    }, [left, shift, reduceMotion]);

    const label =
        left === null
            ? t("camera.unlimited")
            : left === undefined
              ? ""
              : t("camera.shotsLeft", { count: left });
    const last = typeof left === "number" && left > 0 && left <= LAST_SHOTS;
    const above = typeof left === "number" && (allowance === null || left + 1 <= allowance);

    return (
        <View
            style={styles.count}
            accessible
            accessibilityLabel={label}
            accessibilityLiveRegion="polite"
        >
            {left === null ? (
                <Text serif italic style={styles.countNow} maxScale={1}>
                    ∞
                </Text>
            ) : typeof left === "number" ? (
                <Animated.View style={[styles.countRow, rolling]}>
                    <Text serif italic style={[styles.countSide, styles.countFade]} maxScale={1}>
                        {left > 0 ? String(left - 1) : " "}
                    </Text>
                    <Text
                        serif
                        italic
                        style={[styles.countNow, last ? { color: color.candle } : null]}
                        maxScale={1}
                    >
                        {String(left)}
                    </Text>
                    <Text serif italic style={[styles.countSide, styles.countFade]} maxScale={1}>
                        {above ? String(left + 1) : " "}
                    </Text>
                </Animated.View>
            ) : (
                <View style={styles.countWaiting} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    top: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 14,
    },
    title: { flex: 1, minWidth: 0 },
    viewfinder: {
        flex: 1,
        marginHorizontal: 12,
        borderRadius: 28,
        overflow: "hidden",
        backgroundColor: color.surface,
    },
    blink: { backgroundColor: color.white },
    dim: { backgroundColor: color.night },
    demo: {
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 14,
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: "rgba(13, 13, 13, 0.55)",
    },
    failed: {
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 14,
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: "rgba(13, 13, 13, 0.75)",
    },
    cover: {
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        backgroundColor: "rgba(13, 13, 13, 0.72)",
    },
    tools: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: 18,
        paddingHorizontal: 30,
        paddingBottom: 8,
    },
    flash: { flexDirection: "row", alignItems: "center", gap: 3, minWidth: 23 },
    flashAuto: { fontSize: 11, lineHeight: 13, color: TOOL },
    zoom: {
        flexDirection: "row",
        gap: 3,
        backgroundColor: color.chip,
        borderRadius: 14,
        padding: 4,
    },
    zoomSpace: { height: 35 },
    zoomStop: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 11 },
    zoomOn: { backgroundColor: color.segment },
    zoomText: { fontSize: 13.5, lineHeight: 17, color: color.white },
    bottom: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 10,
        paddingHorizontal: 20,
    },
    count: {
        width: 82,
        height: 58,
        borderRadius: 17,
        backgroundColor: color.chip,
        alignItems: "center",
        justifyContent: "center",
    },
    countRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    countSide: { fontSize: 18, lineHeight: 22, color: color.faint },
    countFade: { opacity: 0.55 },
    countNow: { fontSize: 31, lineHeight: 36, color: color.white },
    countWaiting: { width: 22, height: 4, borderRadius: 2, backgroundColor: color.rule },
    shutter: {
        width: 84,
        height: 84,
        borderRadius: 42,
        borderWidth: 4,
        borderColor: color.rule,
        alignItems: "center",
        justifyContent: "center",
    },
    shutterIn: { width: 68, height: 68, borderRadius: 34, backgroundColor: "#2A2A27" },
    last: {
        width: 62,
        height: 62,
        borderRadius: 17,
        overflow: "hidden",
        borderWidth: 2,
        borderColor: "#444444",
        backgroundColor: color.surface,
    },
    lastSending: { borderColor: color.candle },
    lastEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
    screenFlash: { backgroundColor: color.white },
});
