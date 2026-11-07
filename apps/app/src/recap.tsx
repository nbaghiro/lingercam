import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import { PauseIcon } from "phosphor-react-native/src/icons/Pause";
import { useEffect, useEffectEvent, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, asApiError, useLoad, type ApiError } from "@/api";
import { momentsFromPeople, problem, t } from "@/copy";
import { useCode } from "@/event";
import { isHiddenPerson, sizeNoteOnce } from "@/gallery";
import { openPhotoSettings, PhotosDenied, savePhoto, sharePhoto } from "@/save";
import {
    Button,
    Icon,
    Notice,
    Scrim,
    Text,
    color,
    haptic,
    icons,
    photoSource,
    showToast,
    space,
    useReduceMotion,
} from "@/ui";

const SLIDE_MS = 5000;
const FADE_MS = 300;
const TITLE_MS = 3000;
const ZOOM = 0.12;
const SHADE = [
    [0, 0.45],
    [0.22, 0],
    [0.58, 0],
    [1, 0.8],
] as const;

type Slides =
    | { state: "loading" }
    | { state: "ready"; items: GalleryItem[] }
    | { state: "error"; error: ApiError };

/**
 * The recap: the photos the server picked, played as a story. The set is fixed when it opens,
 * so likes made while it plays don't reshuffle it. Under Reduce Motion it holds still and moves
 * on only when tapped.
 */
export function RecapScreen() {
    const code = useCode();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const still = useReduceMotion();
    const [slides, setSlides] = useState<Slides>({ state: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [index, setIndex] = useState(0);
    const [from, setFrom] = useState<number | null>(null);
    const [paused, setPaused] = useState(false);
    const [ended, setEnded] = useState(false);
    const [play, setPlay] = useState(0);
    const [saving, setSaving] = useState(false);
    const [sharing, setSharing] = useState(false);
    const progress = useSharedValue(0);
    const titleOpacity = useSharedValue(1);

    useEffect(() => {
        let live = true;
        api.guest
            .highlights(code, "recap")
            .then((result) => {
                if (live) {
                    const items = result.items.filter(
                        (item) => !isHiddenPerson(code, item.photographer.id),
                    );
                    setSlides({ state: "ready", items });
                }
            })
            .catch((error: unknown) => {
                if (live) setSlides({ state: "error", error: asApiError(error) });
            });
        return () => {
            live = false;
        };
    }, [code, attempt]);

    const items = slides.state === "ready" ? slides.items : [];
    const count = items.length;
    const slide = items[Math.min(index, count - 1)];

    const go = (to: number) => {
        if (to >= count) {
            setEnded(true);
            return;
        }
        const next = Math.max(0, to);
        if (next === index) return;
        progress.set(0);
        setFrom(index);
        setIndex(next);
        setPaused(false);
    };

    const advance = useEffectEvent(() => go(index + 1));

    // Each slide plays for 5 s; the bar and the slow zoom or pan read the same progress.
    useEffect(() => {
        if (count === 0 || ended || paused || still) return;
        const remaining = SLIDE_MS * (1 - progress.get());
        progress.set(withTiming(1, { duration: remaining, easing: Easing.linear }));
        const id = setTimeout(advance, remaining);
        return () => {
            clearTimeout(id);
            cancelAnimation(progress);
        };
    }, [count, index, ended, paused, still, play, progress]);

    // The title shows over the first slide and fades after 3 s.
    useEffect(() => {
        if (count === 0) return;
        titleOpacity.set(1);
        titleOpacity.set(withDelay(TITLE_MS, withTiming(0, { duration: 600 })));
    }, [count, play, titleOpacity]);

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace(`/e/${code}` as Href);
    };

    const watchAgain = () => {
        progress.set(0);
        setFrom(null);
        setIndex(0);
        setEnded(false);
        setPaused(false);
        setPlay((n) => n + 1);
    };

    const title = summary.data?.title ?? "";
    const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.get() }));

    const close = (
        <Pressable
            onPress={leave}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
            hitSlop={14}
            style={[styles.close, { top: insets.top + 22 }]}
        >
            <Icon icon={icons.close} size={22} color={color.white} />
        </Pressable>
    );

    if (slides.state !== "ready" || !slide) {
        return (
            <View style={[styles.screen, styles.center]}>
                {slides.state === "loading" ? (
                    <ActivityIndicator color={color.ash} />
                ) : slides.state === "error" ? (
                    <View style={{ gap: space.m }}>
                        <Notice>
                            {slides.error.code === "not-revealed"
                                ? t("recap.empty")
                                : problem(slides.error.code)}
                        </Notice>
                        <Button
                            label={t("common.retry")}
                            variant="dark"
                            onPress={() => {
                                setSlides({ state: "loading" });
                                setAttempt((n) => n + 1);
                            }}
                        />
                    </View>
                ) : (
                    <Notice>{t("recap.empty")}</Notice>
                )}
                {close}
            </View>
        );
    }

    if (ended) {
        const counts = summary.data
            ? momentsFromPeople(summary.data.photoCount, summary.data.photographerCount)
            : null;
        return (
            <View style={[styles.screen, styles.end, { paddingBottom: insets.bottom + 28 }]}>
                <View style={styles.endText}>
                    <Text serif align="center" style={styles.titleText} accessibilityRole="header">
                        {title}
                    </Text>
                    {counts ? (
                        <Text variant="small" align="center" style={styles.subtitle}>
                            {counts}
                        </Text>
                    ) : null}
                </View>
                <View style={styles.endActs}>
                    <Button label={t("recap.watchAgain")} variant="dark" onPress={watchAgain} />
                    <Button label={t("moment.cta")} onPress={leave} />
                </View>
                {close}
            </View>
        );
    }

    const save = async () => {
        setSaving(true);
        try {
            await savePhoto(slide.url);
            haptic("success");
            const note = sizeNoteOnce();
            showToast(note ? `${t("photo.saved")}. ${note}` : t("photo.saved"));
        } catch (error) {
            if (error instanceof PhotosDenied) {
                showToast(t("save.denied"), {
                    label: t("common.openSettings"),
                    run: openPhotoSettings,
                });
            } else {
                showToast(t("photo.saveFailed"));
            }
        } finally {
            setSaving(false);
        }
    };

    const share = async () => {
        setSharing(true);
        try {
            await sharePhoto(slide.url);
        } catch {
            // Closing the share sheet rejects on the web; nothing to tell.
        } finally {
            setSharing(false);
        }
    };

    const next = items[index + 1];
    const behind = from !== null && from !== index ? items[from] : undefined;
    const shown = [
        ...(next ? [{ photo: next, role: "next" as const }] : []),
        ...(behind ? [{ photo: behind, role: "behind" as const }] : []),
        { photo: slide, role: "current" as const },
    ];

    return (
        <View style={styles.screen}>
            {shown.map(({ photo, role }) => (
                <Slide key={photo.id} photo={photo} role={role} progress={progress} still={still} />
            ))}
            <Scrim stops={SHADE} tint="#000000" />
            <Pressable
                style={StyleSheet.absoluteFill}
                onPress={(e) => go(e.nativeEvent.locationX < width / 3 ? index - 1 : index + 1)}
                onLongPress={() => {
                    if (!still) setPaused(true);
                }}
                onPressOut={() => {
                    if (paused) setPaused(false);
                }}
                delayLongPress={250}
                accessibilityRole="button"
                accessibilityLabel={t("event.photoBy", { name: slide.photographer.name })}
                accessibilityActions={[
                    { name: "next", label: t("recap.next") },
                    { name: "previous", label: t("recap.previous") },
                    { name: "magicTap", label: paused ? t("recap.play") : t("recap.pause") },
                ]}
                onAccessibilityAction={(e) => {
                    if (e.nativeEvent.actionName === "next") go(index + 1);
                    else if (e.nativeEvent.actionName === "previous") go(index - 1);
                    else if (!still) setPaused((p) => !p);
                }}
            />

            <View style={[styles.bars, { top: insets.top + 8 }]} pointerEvents="none">
                {items.map((s, i) => (
                    <Bar
                        key={s.id}
                        state={i < index ? "done" : i > index ? "todo" : "now"}
                        progress={progress}
                        still={still}
                    />
                ))}
            </View>
            {close}

            {paused ? (
                <View style={styles.paused} pointerEvents="none">
                    <View
                        style={styles.pausedBadge}
                        accessible
                        accessibilityLabel={t("recap.paused")}
                    >
                        <Icon icon={PauseIcon} size={26} weight="fill" color={color.white} />
                    </View>
                </View>
            ) : null}

            <View
                style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}
                pointerEvents="box-none"
            >
                {index === 0 ? (
                    <Animated.View style={[styles.title, titleStyle]} pointerEvents="none">
                        <Text serif align="center" style={styles.titleText}>
                            {title}
                        </Text>
                        <Text variant="small" align="center" style={styles.subtitle}>
                            {t("recap.subtitle", { seconds: (count * SLIDE_MS) / 1000 })}
                        </Text>
                    </Animated.View>
                ) : null}
                <Text serif italic style={styles.credit} numberOfLines={1}>
                    {slide.photographer.name}
                </Text>
                <View style={styles.acts}>
                    <Button
                        variant="glass"
                        label={t("recap.save")}
                        loading={saving}
                        onPress={() => {
                            save().catch(() => setSaving(false));
                        }}
                        style={{ flex: 1 }}
                    />
                    <Button
                        icon={icons.share}
                        label={t("recap.share")}
                        loading={sharing}
                        onPress={() => {
                            share().catch(() => setSharing(false));
                        }}
                        style={{ flex: 1 }}
                    />
                </View>
            </View>
        </View>
    );
}

function Bar({
    state,
    progress,
    still,
}: {
    state: "done" | "now" | "todo";
    progress: SharedValue<number>;
    still: boolean;
}) {
    const fill = useAnimatedStyle(() => ({
        width: `${state === "done" || (state === "now" && still) ? 100 : state === "now" ? progress.get() * 100 : 0}%`,
    }));
    return (
        <View style={styles.bar}>
            <Animated.View style={[styles.fill, fill]} />
        </View>
    );
}

/**
 * One slide. Portrait photos zoom slowly; landscape ones fill the height and pan across the
 * frame, so nothing is cropped for good. The current slide fades in over the one before once its
 * photo has loaded; the next one waits underneath, already loading.
 */
function Slide({
    photo,
    role,
    progress,
    still,
}: {
    photo: GalleryItem;
    role: "current" | "behind" | "next";
    progress: SharedValue<number>;
    still: boolean;
}) {
    const { width, height } = useWindowDimensions();
    const [loaded, setLoaded] = useState(false);
    const opacity = useSharedValue(role === "current" ? 0 : role === "behind" ? 1 : 0);
    const played = useSharedValue(0);
    const active = role === "current";

    useAnimatedReaction(
        () => progress.get(),
        (value) => {
            if (active) played.set(value);
        },
        [active],
    );

    useEffect(() => {
        if (role === "next") opacity.set(0);
        if (role === "current" && loaded) {
            opacity.set(0);
            opacity.set(withTiming(1, { duration: FADE_MS }));
        }
    }, [role, loaded, opacity]);

    const landscape = photo.width > photo.height;
    const panWidth = landscape ? Math.max(width, (height * photo.width) / photo.height) : width;
    const overflow = panWidth - width;

    const style = useAnimatedStyle(() => {
        if (still) return { opacity: opacity.get() };
        return {
            opacity: opacity.get(),
            transform: landscape
                ? [{ translateX: -overflow * played.get() }]
                : [{ scale: 1 + ZOOM * played.get() }],
        };
    });

    const source = photoSource(photo.url, photo.id, "full");
    return (
        <Animated.View
            style={[StyleSheet.absoluteFill, styles.slide, style]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
        >
            {landscape && still ? (
                <>
                    <Image
                        source={photoSource(photo.thumbUrl, photo.id, "thumb")}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        blurRadius={60}
                    />
                    <View style={[StyleSheet.absoluteFill, styles.darken]} />
                    <Image
                        source={source}
                        style={StyleSheet.absoluteFill}
                        contentFit="contain"
                        onLoad={() => setLoaded(true)}
                    />
                </>
            ) : (
                <Image
                    source={source}
                    style={landscape ? { width: panWidth, height } : StyleSheet.absoluteFill}
                    contentFit="cover"
                    onLoad={() => setLoaded(true)}
                />
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night, overflow: "hidden" },
    center: { alignItems: "center", justifyContent: "center" },
    slide: { backgroundColor: color.night, overflow: "hidden" },
    darken: { backgroundColor: "rgba(0, 0, 0, 0.55)" },
    bars: {
        position: "absolute",
        left: 0,
        right: 0,
        flexDirection: "row",
        gap: 4,
        paddingHorizontal: 16,
    },
    bar: {
        flex: 1,
        height: 3,
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: "rgba(255, 255, 255, 0.35)",
    },
    fill: { height: 3, backgroundColor: color.white },
    close: { position: "absolute", right: 16, padding: 2 },
    paused: {
        ...StyleSheet.absoluteFill,
        alignItems: "center",
        justifyContent: "center",
    },
    pausedBadge: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.glass,
    },
    bottom: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 22,
        gap: 18,
    },
    title: { paddingHorizontal: 8, marginBottom: 22 },
    titleText: { fontSize: 48, lineHeight: 49, letterSpacing: -0.96, color: color.paper },
    subtitle: { marginTop: 12, color: "#DDDDDD" },
    credit: { fontSize: 17, lineHeight: 22, color: color.paper },
    acts: { flexDirection: "row", gap: 10 },
    end: { justifyContent: "flex-end", paddingHorizontal: 22 },
    endText: { flex: 1, justifyContent: "center" },
    endActs: { gap: space.s },
});
