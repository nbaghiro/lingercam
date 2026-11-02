import { normalizeJoinCode } from "@linger/core/events";
import { DEFAULT_LOOK, type LookId } from "@linger/core/film";
import { canShoot } from "@linger/core/shots";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { trackShot } from "@/activity";
import { api, type ApiError, type EventSummary, useLoad } from "@/api";
import { formatDuration, revealWhen, t } from "@/copy";
import { InviteSheet } from "@/invite";
import { LookImage } from "@/look";
import { Button, Icon, IconButton, Notice, Text, color, icons } from "@/ui";
import { enqueue, setShotsLeft, useShots, type ShotsState } from "@/uploads";

// The camera screen's frame, shared by the native camera (camera.tsx) and the browser camera
// (camera.web.tsx). Each supplies a Lens: the live view and a way to take a photo.

export interface Lens {
    /** Drawn inside the rounded viewfinder. */
    view: ReactNode;
    /** Takes a photo and resolves to a uri the upload queue can keep. */
    capture: () => Promise<string>;
    flash: { on: boolean; available: boolean; toggle: () => void };
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
    shots: ShotsState;
    look: LookId;
    now: Date;
}

/** Loads the event and this guest, and sends anyone who hasn't joined to the join sheet. */
export function useCameraEvent(): CameraEvent {
    const params = useLocalSearchParams<{ code: string }>();
    const code = normalizeJoinCode(params.code ?? "") ?? params.code ?? "";
    const router = useRouter();
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const me = useLoad(`me:${code}`, () => api.guest.me(code));
    const shots = useShots(code);
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        if (me.data) setShotsLeft(code, me.data.shotsLeft);
    }, [code, me.data]);

    useEffect(() => {
        if (me.error?.code === "not-joined") router.replace(`/j/${code}` as Href);
    }, [code, me.error, router]);

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);

    return {
        code,
        summary: summary.data,
        error: summary.error,
        shots,
        look: summary.data?.look ?? DEFAULT_LOOK,
        now,
    };
}

export function CameraFrame({ event, lens }: { event: CameraEvent; lens: Lens }) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { code, summary, shots, now } = event;
    const [last, setLast] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    const [inviting, setInviting] = useState(false);
    const blink = useSharedValue(0);
    const blinkStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

    const endsAt = summary ? Date.parse(summary.endsAt) : 0;
    const open = summary !== undefined && canShoot(summary, now);
    const out = shots.left === 0;

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace(`/e/${code}` as Href);
    };

    const shoot = async () => {
        if (busy || !open || out || lens.blocked) return;
        setBusy(true);
        setFailed(false);
        if (Platform.OS !== "web") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => null);
        }
        blink.set(
            withSequence(withTiming(0.85, { duration: 60 }), withTiming(0, { duration: 260 })),
        );
        const takenAt = new Date();
        try {
            const uri = await lens.capture();
            enqueue(code, uri, takenAt);
            setLast(uri);
            if (summary && shots.left !== undefined) {
                const left = shots.left === null ? null : Math.max(0, shots.left - 1);
                trackShot(summary, left).catch(() => null);
            }
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={styles.screen}>
            <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
                <IconButton
                    icon={icons.back}
                    onPress={leave}
                    accessibilityLabel={t("common.back")}
                />
                <View style={styles.title}>
                    <Text variant="name" align="center" numberOfLines={1}>
                        {summary?.title ?? " "}
                    </Text>
                    <Text variant="caption" tone="ash" align="center">
                        {open
                            ? t("camera.left", { time: formatDuration(endsAt - now.getTime()) })
                            : " "}
                    </Text>
                </View>
                <IconButton
                    icon={icons.qr}
                    onPress={() => setInviting(true)}
                    accessibilityLabel={t("event.showCode")}
                    disabled={!summary}
                />
            </View>

            <View style={styles.viewfinder}>
                {lens.view}
                <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, styles.blink, blinkStyle]}
                />
                {lens.demo && open ? (
                    <View style={styles.demo} pointerEvents="none">
                        <Text variant="caption" tone="soft" align="center">
                            {t("camera.demo")}
                        </Text>
                    </View>
                ) : null}
                {summary && !open ? (
                    <Cover>
                        <Text variant="small" tone="soft" align="center">
                            {t("camera.ended")}
                        </Text>
                        <Button label={t("camera.seeEvent")} variant="glass" onPress={leave} />
                    </Cover>
                ) : out && open ? (
                    <Cover>
                        <Text variant="title" align="center">
                            {t("camera.out")}
                        </Text>
                        <Text variant="small" tone="soft" align="center">
                            {t("camera.outBody", { when: whenPhrase(summary, now) })}
                        </Text>
                        <Button label={t("camera.seeEvent")} variant="glass" onPress={leave} />
                    </Cover>
                ) : lens.blocked ? (
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
                ) : null}
                {event.error ? (
                    <Cover>
                        <Notice>{t("join.loadFailed")}</Notice>
                    </Cover>
                ) : null}
            </View>

            {failed ? <Notice>{t("camera.failed")}</Notice> : null}

            <View style={styles.tools}>
                <Pressable
                    onPress={lens.flash.toggle}
                    disabled={!lens.flash.available}
                    accessibilityRole="button"
                    accessibilityLabel={t(lens.flash.on ? "camera.flashOn" : "camera.flashOff")}
                    accessibilityState={{ disabled: !lens.flash.available }}
                    hitSlop={12}
                    style={{ opacity: lens.flash.available ? 1 : 0.35 }}
                >
                    <Icon
                        icon={lens.flash.on ? icons.flashOn : icons.flashOff}
                        size={23}
                        color={lens.flash.on ? color.candle : TOOL}
                        {...(lens.flash.on ? { weight: "fill" as const } : {})}
                    />
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
                <Counter left={shots.left} />
                <Pressable
                    onPress={() => {
                        shoot().catch(() => null);
                    }}
                    disabled={!open || out || busy || lens.blocked !== null}
                    accessibilityRole="button"
                    accessibilityLabel={t("camera.shutter")}
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
                                !open || out ? { opacity: 0.5 } : null,
                            ]}
                        />
                    )}
                </Pressable>
                <Pressable
                    onPress={leave}
                    accessibilityRole="button"
                    accessibilityLabel={t("camera.seeEvent")}
                    style={styles.last}
                >
                    {last ? (
                        <LookImage
                            source={last}
                            look={event.look}
                            style={StyleSheet.absoluteFill}
                        />
                    ) : null}
                </Pressable>
            </View>

            {summary ? (
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
    if (!zoom.available) {
        return (
            <View style={styles.zoom}>
                <View style={[styles.zoomStop, styles.zoomOn]}>
                    <Text variant="caption" style={styles.zoomText}>
                        1×
                    </Text>
                </View>
            </View>
        );
    }
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
                        onPress={() => zoom.set(wide)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={t("camera.zoom", { level: label })}
                        style={[styles.zoomStop, on ? styles.zoomOn : null]}
                    >
                        <Text
                            variant="caption"
                            style={[styles.zoomText, { color: on ? color.white : color.ash }]}
                        >
                            {label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

/** The shots left, with its neighbours either side, rolling over as each photo is taken. */
function Counter({ left }: { left: number | null | undefined }) {
    const shift = useSharedValue(0);
    const previous = useRef(left);
    const rolling = useAnimatedStyle(() => ({ transform: [{ translateX: shift.value }] }));

    useEffect(() => {
        if (typeof left === "number" && typeof previous.current === "number") {
            if (left !== previous.current) {
                shift.set(left < previous.current ? -22 : 22);
                shift.set(withTiming(0, { duration: 260 }));
            }
        }
        previous.current = left;
    }, [left, shift]);

    const label =
        left === null
            ? t("camera.unlimited")
            : left === undefined
              ? ""
              : t("camera.shotsLeft", { count: left });

    return (
        <View style={styles.count} accessible accessibilityLabel={label}>
            {left === null ? (
                <Text serif italic style={styles.countNow}>
                    ∞
                </Text>
            ) : typeof left === "number" ? (
                <Animated.View style={[styles.countRow, rolling]}>
                    <Text serif italic style={styles.countSide}>
                        {left > 0 ? String(left - 1) : " "}
                    </Text>
                    <Text serif italic style={styles.countNow}>
                        {String(left)}
                    </Text>
                    <Text serif italic style={styles.countSide}>
                        {String(left + 1)}
                    </Text>
                </Animated.View>
            ) : null}
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
    zoom: {
        flexDirection: "row",
        gap: 3,
        backgroundColor: color.chip,
        borderRadius: 14,
        padding: 4,
    },
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
        overflow: "hidden",
    },
    countRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    countSide: { fontSize: 18, lineHeight: 22, color: color.faint },
    countNow: { fontSize: 31, lineHeight: 36, color: color.white },
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
});
