import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, joinLink, useLoad } from "@/api";
import { t } from "@/copy";
import { useCode } from "@/event";
import { loadWholeGallery, refreshGallery, useGallery } from "@/gallery";
import { shareLink } from "@/invite";
import { PhotosDenied, savePhoto } from "@/save";
import { Button, IconButton, Notice, Scrim, Text, color, icons } from "@/ui";

const SLIDE_MS = 5000;
const TICK_MS = 50;
const MOST = 12;
const SHADE = [
    [0, 0.45],
    [0.22, 0],
    [0.58, 0],
    [1, 0.8],
] as const;

/** The most liked photos, up to twelve, played in the order they were taken. */
function pick(items: GalleryItem[]): GalleryItem[] {
    return [...items]
        .sort((a, b) => b.likes - a.likes || a.takenAt.localeCompare(b.takenAt))
        .slice(0, MOST)
        .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

/** The recap: the event's best photos as a story, each with a slow zoom. */
export function RecapScreen() {
    const code = useCode();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const gallery = useGallery(code);
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const [{ index, elapsed }, setPosition] = useState({ index: 0, elapsed: 0 });
    const [paused, setPaused] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        refreshGallery(code)
            .then(() => loadWholeGallery(code))
            .catch(() => null);
    }, [code]);

    const slides = pick(gallery.items);
    const count = slides.length;
    const slide = slides[Math.min(index, count - 1)];
    const last = index >= count - 1;

    useEffect(() => {
        if (paused || count === 0) return;
        const id = setInterval(() => {
            setPosition((p) => {
                const ms = p.elapsed + TICK_MS;
                if (ms < SLIDE_MS) return { index: p.index, elapsed: ms };
                if (p.index >= count - 1)
                    return p.elapsed === SLIDE_MS ? p : { ...p, elapsed: SLIDE_MS };
                return { index: p.index + 1, elapsed: 0 };
            });
        }, TICK_MS);
        return () => clearInterval(id);
    }, [paused, count]);

    const go = (to: number) => {
        setPosition({ index: Math.max(0, Math.min(count - 1, to)), elapsed: 0 });
        setPaused(false);
    };

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace(`/e/${code}` as Href);
    };

    const title = summary.data?.title ?? "";

    if (!slide) {
        return (
            <View style={[styles.screen, styles.center]}>
                {gallery.first && !gallery.loading ? <Notice>{t("recap.empty")}</Notice> : null}
                <View style={[styles.close, { top: insets.top + 8 }]}>
                    <IconButton
                        icon={icons.close}
                        variant="glass"
                        onPress={leave}
                        accessibilityLabel={t("common.close")}
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <Slide key={slide.id} photo={slide} paused={paused} />
            <Scrim stops={SHADE} tint="#000000" />
            <Pressable
                style={StyleSheet.absoluteFill}
                onPress={(e) => go(e.nativeEvent.locationX < width / 3 ? index - 1 : index + 1)}
                onLongPress={() => setPaused(true)}
                onPressOut={() => {
                    if (paused && !last) setPaused(false);
                }}
                delayLongPress={250}
                accessibilityRole="button"
                accessibilityLabel={paused ? t("recap.play") : t("recap.pause")}
            />

            <View style={[styles.bars, { top: insets.top + 8 }]} pointerEvents="none">
                {slides.map((s, i) => (
                    <View key={s.id} style={styles.bar}>
                        <View
                            style={[
                                styles.fill,
                                {
                                    width: `${i < index ? 100 : i === index ? (elapsed / SLIDE_MS) * 100 : 0}%`,
                                },
                            ]}
                        />
                    </View>
                ))}
            </View>
            <View style={[styles.close, { top: insets.top + 22 }]}>
                <IconButton
                    icon={icons.close}
                    variant="glass"
                    onPress={leave}
                    accessibilityLabel={t("common.close")}
                />
            </View>

            <View
                style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 12) + 16 }]}
                pointerEvents="box-none"
            >
                <View style={styles.title} pointerEvents="none">
                    <Text serif align="center" style={styles.titleText}>
                        {title}
                    </Text>
                    <Text variant="small" align="center" style={styles.subtitle}>
                        {t("recap.subtitle", { seconds: (count * SLIDE_MS) / 1000 })}
                    </Text>
                </View>
                {note ? (
                    <Text variant="small" align="center" style={styles.note}>
                        {note}
                    </Text>
                ) : null}
                <View style={styles.acts}>
                    <Button
                        variant="glass"
                        label={t("recap.save")}
                        onPress={() => {
                            savePhoto(slide.url)
                                .then(() => setNote(t("photo.saved")))
                                .catch((error: unknown) =>
                                    setNote(
                                        error instanceof PhotosDenied
                                            ? t("photo.allowPhotos")
                                            : t("photo.saveFailed"),
                                    ),
                                );
                        }}
                        style={{ flex: 1 }}
                    />
                    <Button
                        icon={icons.share}
                        label={t("recap.share")}
                        onPress={() => {
                            const url = joinLink(code);
                            shareLink(title, url, t("recap.shareMessage", { title, url })).catch(
                                () => null,
                            );
                        }}
                        style={{ flex: 1 }}
                    />
                </View>
            </View>
        </View>
    );
}

function Slide({ photo, paused }: { photo: GalleryItem; paused: boolean }) {
    const zoom = useSharedValue(1);
    const style = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }] }));

    useEffect(() => {
        if (paused) return;
        zoom.set(
            withTiming(1.12, {
                duration: SLIDE_MS * ((1.12 - zoom.get()) / 0.12),
                easing: Easing.linear,
            }),
        );
    }, [paused, zoom]);

    return (
        <Animated.View style={[StyleSheet.absoluteFill, style]}>
            <Image
                source={photo.url}
                placeholder={photo.thumbUrl}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={400}
            />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night, overflow: "hidden" },
    center: { alignItems: "center", justifyContent: "center" },
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
    close: { position: "absolute", right: 16 },
    bottom: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 22,
        gap: 18,
    },
    title: { paddingHorizontal: 8, marginBottom: 40 },
    titleText: { fontSize: 48, lineHeight: 49, letterSpacing: -0.96, color: color.paper },
    subtitle: { marginTop: 12, color: "#DDDDDD" },
    note: {
        alignSelf: "center",
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: color.glass,
        color: color.paper,
    },
    acts: { flexDirection: "row", gap: 10 },
});
