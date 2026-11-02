import { LOOKS } from "@linger/core/film";
import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Platform,
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeIn,
    FadeOut,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { api, asApiError, useLoad } from "@/api";
import { formatCount, formatTime, problem, t } from "@/copy";
import { useCode, useHostEvent } from "@/event";
import {
    loadMoreGallery,
    patchPhoto,
    refreshGallery,
    removePhoto,
    showRoll,
    sizeNoteOnce,
    useFreshGallery,
    useGallery,
} from "@/gallery";
import { openPhotoSettings, PhotosDenied, savePhoto, sharePhoto } from "@/save";
import {
    Button,
    Icon,
    IconButton,
    Notice,
    Scrim,
    Sheet,
    Text,
    color,
    confirm,
    haptic,
    icons,
    photoSource,
    showToast,
    space,
    useReduceMotion,
} from "@/ui";

const SHADE = [
    [0, 0.45],
    [0.22, 0],
    [0.58, 0],
    [1, 0.8],
] as const;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

/**
 * The full-screen viewer, paging through the photos the event screen loaded, or through one
 * person's roll when opened with `?guest=`.
 */
export function PhotoScreen() {
    const code = useCode();
    const params = useLocalSearchParams<{ photo: string; guest?: string }>();
    const guest = params.guest || undefined;
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const gallery = useGallery(code, guest);
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const host = useHostEvent(code);
    const still = useReduceMotion();
    const list = useRef<FlatList<GalleryItem>>(null);
    const [current, setCurrent] = useState(params.photo ?? "");
    const [saving, setSaving] = useState(false);
    const [sharing, setSharing] = useState(false);
    const [zoomed, setZoomed] = useState(false);
    const [controls, setControls] = useState(true);
    const [more, setMore] = useState(false);

    useFreshGallery(code, guest);

    const items = gallery.items;
    const index = items.findIndex((item) => item.id === current);
    const item = items[index];

    // Opened from a link: load the gallery, then keep paging until the photo turns up.
    useEffect(() => {
        if (!gallery.first && !gallery.loading && !gallery.error) {
            refreshGallery(code, guest).catch(() => null);
        } else if (index < 0 && gallery.cursor && !gallery.loading) {
            loadMoreGallery(code, guest).catch(() => null);
        }
    }, [code, guest, gallery.first, gallery.loading, gallery.error, gallery.cursor, index]);

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace(`/e/${code}` as Href);
    };

    const goTo = (to: number) => {
        const next = items[to];
        if (!next) return;
        setCurrent(next.id);
        list.current?.scrollToIndex({ index: to, animated: !still });
        if (to >= items.length - 3) loadMoreGallery(code, guest).catch(() => null);
    };

    const onKey = useEffectEvent((key: string) => {
        if (key === "ArrowRight") goTo(index + 1);
        else if (key === "ArrowLeft") goTo(index - 1);
        else if (key === "Escape") leave();
    });
    useEffect(() => {
        if (Platform.OS !== "web" || typeof document === "undefined") return;
        const handle = (e: KeyboardEvent) => onKey(e.key);
        document.addEventListener("keydown", handle);
        return () => document.removeEventListener("keydown", handle);
    }, []);

    const missing =
        !item && gallery.first !== undefined && !gallery.loading && gallery.cursor === null;

    if (!item) {
        return (
            <View style={[styles.screen, styles.center]}>
                {missing || gallery.error ? (
                    <Notice>{t("photo.missing")}</Notice>
                ) : (
                    <ActivityIndicator color={color.ash} />
                )}
                <View style={[styles.top, { top: insets.top + 8 }]}>
                    <IconButton
                        icon={icons.back}
                        variant="glass"
                        onPress={leave}
                        accessibilityLabel={t("common.back")}
                    />
                </View>
            </View>
        );
    }

    const total = gallery.first?.kind === "photos" ? gallery.first.total : items.length;
    const timeZone = summary.data?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const look = summary.data ? LOOKS[summary.data.look].name : null;
    const time = formatTime(new Date(item.takenAt), timeZone);
    const mine = summary.data?.viewer.guestId === item.photographer.id;

    const like = async () => {
        const liked = !item.likedByMe;
        haptic("light");
        patchPhoto(code, item.id, { likedByMe: liked, likes: item.likes + (liked ? 1 : -1) });
        try {
            const result = await api.shots.like(item.id);
            patchPhoto(code, item.id, { likedByMe: result.liked, likes: result.likes });
        } catch {
            patchPhoto(code, item.id, { likedByMe: item.likedByMe, likes: item.likes });
        }
    };

    const save = async () => {
        setSaving(true);
        try {
            await savePhoto(item.url);
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
            await sharePhoto(item.url);
        } catch {
            // Closing the share sheet rejects on the web; nothing to tell.
        } finally {
            setSharing(false);
        }
    };

    const report = () => {
        setMore(false);
        confirm(t("photo.reportTitle"), t("photo.reportBody"), t("photo.report"), () => {
            api.shots
                .report(item.id)
                .then(() => showToast(t("photo.reported")))
                .catch(() => showToast(t("photo.reportFailed")));
        });
    };

    const setHidden = (photo: GalleryItem, hidden: boolean) => {
        patchPhoto(code, photo.id, { hidden });
        if (hidden) {
            showToast(t("photo.hiddenNote"), {
                label: t("common.undo"),
                run: () => setHidden(photo, false),
            });
        }
        api.shots.hide(photo.id, hidden).catch((error: unknown) => {
            patchPhoto(code, photo.id, { hidden: !hidden });
            showToast(problem(asApiError(error).code));
        });
    };

    const remove = () => {
        setMore(false);
        const photo = item;
        confirm(t("photo.removeTitle"), t("photo.removeBody"), t("photo.remove"), () => {
            api.shots
                .remove(photo.id)
                .then(() => {
                    const next = items[index + 1] ?? items[index - 1];
                    removePhoto(code, photo.id);
                    if (next) setCurrent(next.id);
                    else leave();
                })
                .catch((error: unknown) => showToast(problem(asApiError(error).code)));
        });
    };

    const openRoll = () => {
        showRoll(code, item.photographer);
        if (router.canGoBack()) router.back();
        else router.replace(`/e/${code}` as Href);
    };

    return (
        <View style={styles.screen}>
            <FlatList
                ref={list}
                data={items}
                horizontal
                pagingEnabled
                scrollEnabled={!zoomed}
                showsHorizontalScrollIndicator={false}
                initialScrollIndex={index}
                getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
                keyExtractor={(photo) => photo.id}
                onMomentumScrollEnd={(e) => {
                    const page = Math.round(e.nativeEvent.contentOffset.x / width);
                    const next = items[page];
                    if (next) setCurrent(next.id);
                }}
                onEndReached={() => {
                    loadMoreGallery(code, guest).catch(() => null);
                }}
                renderItem={({ item: photo }) => (
                    <Page
                        photo={photo}
                        width={width}
                        height={height}
                        active={photo.id === item.id}
                        onZoom={setZoomed}
                        onTap={() => setControls((shown) => !shown)}
                        onDismiss={leave}
                    />
                )}
            />

            {controls ? (
                <Animated.View
                    entering={FadeIn.duration(180)}
                    exiting={FadeOut.duration(180)}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="box-none"
                >
                    <Scrim stops={SHADE} tint="#000000" />

                    <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
                        <IconButton
                            icon={icons.back}
                            variant="glass"
                            onPress={leave}
                            accessibilityLabel={t("common.back")}
                        />
                        <View style={styles.position} pointerEvents="none">
                            <Text variant="small" align="center" style={styles.positionText}>
                                {t("photo.position", { index: index + 1, total })}
                            </Text>
                        </View>
                        <View style={styles.right}>
                            <IconButton
                                icon={icons.more}
                                variant="glass"
                                onPress={() => setMore(true)}
                                accessibilityLabel={t("photo.more")}
                            />
                            {sharing ? (
                                <View
                                    style={styles.busy}
                                    accessible
                                    accessibilityLabel={t("photo.share")}
                                    accessibilityState={{ busy: true }}
                                >
                                    <ActivityIndicator color={color.paper} />
                                </View>
                            ) : (
                                <IconButton
                                    icon={icons.share}
                                    variant="glass"
                                    onPress={() => {
                                        share().catch(() => setSharing(false));
                                    }}
                                    accessibilityLabel={t("photo.share")}
                                />
                            )}
                        </View>
                    </View>

                    <View
                        style={[styles.bottom, { bottom: Math.max(insets.bottom, 12) + 16 }]}
                        pointerEvents="box-none"
                    >
                        <View>
                            <Pressable
                                onPress={openRoll}
                                accessibilityRole="button"
                                accessibilityLabel={t("event.roll", {
                                    name: item.photographer.name,
                                })}
                                style={{ alignSelf: "flex-start" }}
                            >
                                <Text serif italic style={styles.who} numberOfLines={1}>
                                    {item.photographer.name}
                                </Text>
                            </Pressable>
                            <Text variant="small" tone="soft" style={{ marginTop: space.xs }}>
                                {look ? t("photo.meta", { time, look }) : time}
                            </Text>
                            {item.hidden ? (
                                <View style={styles.hidden}>
                                    <Icon icon={icons.hide} size={16} color={color.paper} />
                                    <Text variant="small">{t("photo.hiddenNote")}</Text>
                                </View>
                            ) : null}
                        </View>
                        <View style={styles.acts}>
                            <LikeButton
                                liked={item.likedByMe}
                                likes={item.likes}
                                still={still}
                                onPress={() => {
                                    like().catch(() => null);
                                }}
                            />
                            <Button
                                icon={icons.download}
                                label={t("photo.save")}
                                loading={saving}
                                onPress={() => {
                                    save().catch(() => setSaving(false));
                                }}
                                style={{ flex: 2 }}
                            />
                        </View>
                    </View>
                </Animated.View>
            ) : null}

            <Sheet visible={more} onClose={() => setMore(false)}>
                <View style={{ gap: space.s }}>
                    {host ? (
                        <Button
                            variant="dark"
                            icon={item.hidden ? icons.show : icons.hide}
                            label={item.hidden ? t("photo.unhide") : t("photo.hide")}
                            onPress={() => {
                                setMore(false);
                                setHidden(item, !item.hidden);
                            }}
                        />
                    ) : null}
                    {mine ? (
                        <Button
                            variant="dark"
                            icon={icons.trash}
                            label={t("photo.remove")}
                            onPress={remove}
                        />
                    ) : null}
                    {!host && !mine ? (
                        <Button
                            variant="dark"
                            icon={icons.report}
                            label={t("photo.report")}
                            onPress={report}
                        />
                    ) : null}
                    <Button
                        variant="dark"
                        label={t("common.cancel")}
                        onPress={() => setMore(false)}
                    />
                </View>
            </Sheet>
        </View>
    );
}

function LikeButton({
    liked,
    likes,
    still,
    onPress,
}: {
    liked: boolean;
    likes: number;
    still: boolean;
    onPress: () => void;
}) {
    const scale = useSharedValue(1);
    const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
    return (
        <Pressable
            onPress={() => {
                if (!liked && !still) {
                    scale.set(withSequence(withTiming(1.18, { duration: 120 }), withSpring(1)));
                }
                onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${t("photo.like")}, ${formatCount(likes)}`}
            accessibilityState={{ selected: liked }}
            style={({ pressed }) => [styles.like, { opacity: pressed ? 0.82 : 1 }]}
        >
            <Animated.View style={style}>
                <Icon icon={icons.heart} weight={liked ? "fill" : "regular"} />
            </Animated.View>
            <Text weight="semibold">{formatCount(likes)}</Text>
        </Pressable>
    );
}

/**
 * One photo: the whole frame over a blurred, darkened copy of itself. Pinch or double-tap to
 * zoom, drag down to close, tap to show or hide the controls.
 */
function Page({
    photo,
    width,
    height,
    active,
    onZoom,
    onTap,
    onDismiss,
}: {
    photo: GalleryItem;
    width: number;
    height: number;
    active: boolean;
    onZoom: (zoomed: boolean) => void;
    onTap: () => void;
    onDismiss: () => void;
}) {
    const scale = useSharedValue(1);
    const baseScale = useSharedValue(1);
    const x = useSharedValue(0);
    const y = useSharedValue(0);
    const baseX = useSharedValue(0);
    const baseY = useSharedValue(0);
    const drop = useSharedValue(0);
    const [zoomed, setZoomed] = useState(false);

    const reportZoom = (next: boolean) => {
        setZoomed(next);
        onZoom(next);
    };

    // Paging away from a zoomed photo leaves it at its normal size.
    useEffect(() => {
        if (active) return;
        scale.set(1);
        baseScale.set(1);
        x.set(0);
        y.set(0);
    }, [active, scale, baseScale, x, y]);

    const reset = () => {
        "worklet";
        scale.set(withTiming(1));
        baseScale.set(1);
        x.set(withTiming(0));
        y.set(withTiming(0));
        baseX.set(0);
        baseY.set(0);
        scheduleOnRN(reportZoom, false);
    };

    const clampX = (value: number, s: number) => {
        "worklet";
        const max = ((s - 1) * width) / 2;
        return Math.min(max, Math.max(-max, value));
    };
    const clampY = (value: number, s: number) => {
        "worklet";
        const max = ((s - 1) * height) / 2;
        return Math.min(max, Math.max(-max, value));
    };

    const pinch = Gesture.Pinch()
        .onUpdate((e) => {
            scale.set(Math.min(MAX_ZOOM, Math.max(1, baseScale.get() * e.scale)));
        })
        .onEnd(() => {
            if (scale.get() <= 1.02) {
                reset();
                return;
            }
            baseScale.set(scale.get());
            x.set(clampX(x.get(), scale.get()));
            y.set(clampY(y.get(), scale.get()));
            baseX.set(x.get());
            baseY.set(y.get());
            scheduleOnRN(reportZoom, true);
        });

    const move = Gesture.Pan()
        .enabled(zoomed)
        .averageTouches(true)
        .onUpdate((e) => {
            x.set(clampX(baseX.get() + e.translationX, scale.get()));
            y.set(clampY(baseY.get() + e.translationY, scale.get()));
        })
        .onEnd(() => {
            baseX.set(x.get());
            baseY.set(y.get());
        });

    const dismiss = Gesture.Pan()
        .enabled(!zoomed)
        .activeOffsetY(12)
        .failOffsetX([-12, 12])
        .onUpdate((e) => {
            drop.set(Math.max(0, e.translationY));
        })
        .onEnd((e) => {
            if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
                scheduleOnRN(onDismiss);
            } else {
                drop.set(withSpring(0));
            }
        });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd((e) => {
            if (scale.get() > 1) {
                reset();
                return;
            }
            const s = DOUBLE_TAP_ZOOM;
            const tx = clampX((1 - s) * (e.x - width / 2), s);
            const ty = clampY((1 - s) * (e.y - height / 2), s);
            scale.set(withTiming(s));
            baseScale.set(s);
            x.set(withTiming(tx));
            y.set(withTiming(ty));
            baseX.set(tx);
            baseY.set(ty);
            scheduleOnRN(reportZoom, true);
        });

    const tap = Gesture.Tap()
        .requireExternalGestureToFail(doubleTap)
        .onEnd(() => {
            scheduleOnRN(onTap);
        });

    const gesture = Gesture.Race(
        dismiss,
        Gesture.Simultaneous(pinch, move),
        Gesture.Exclusive(doubleTap, tap),
    );

    const photoStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: x.get() },
            { translateY: y.get() + drop.get() },
            { scale: scale.get() * (1 - Math.min(drop.get(), 400) / 2000) },
        ],
    }));
    const backStyle = useAnimatedStyle(() => ({
        opacity: 1 - Math.min(drop.get(), 300) / 400,
    }));

    return (
        <GestureDetector gesture={gesture}>
            <View style={{ width, height, backgroundColor: color.night, overflow: "hidden" }}>
                <Animated.View style={[StyleSheet.absoluteFill, backStyle]}>
                    <Image
                        source={photoSource(photo.thumbUrl, photo.id, "thumb")}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        blurRadius={Platform.OS === "web" ? 30 : 60}
                    />
                    <View style={[StyleSheet.absoluteFill, styles.darken]} />
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, photoStyle]}>
                    <Image
                        source={photoSource(photo.url, photo.id, "full")}
                        placeholder={photoSource(photo.thumbUrl, photo.id, "thumb")}
                        style={StyleSheet.absoluteFill}
                        contentFit="contain"
                        transition={150}
                        accessibilityLabel={t("event.photoBy", { name: photo.photographer.name })}
                    />
                </Animated.View>
            </View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    center: { alignItems: "center", justifyContent: "center" },
    top: {
        position: "absolute",
        left: 0,
        right: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 18,
    },
    position: {
        position: "absolute",
        left: 0,
        right: 0,
        alignItems: "center",
    },
    positionText: { color: "#E5E2DB" },
    right: { flexDirection: "row", gap: 10 },
    busy: {
        width: 48,
        height: 48,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color.glass,
    },
    bottom: { position: "absolute", left: 0, right: 0, paddingHorizontal: 22, gap: 18 },
    who: { fontSize: 32, lineHeight: 35, color: color.paper },
    hidden: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: space.s },
    acts: { flexDirection: "row", gap: 10 },
    like: {
        flex: 1,
        minHeight: 56,
        borderRadius: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        backgroundColor: color.glass,
    },
    darken: { backgroundColor: "rgba(0, 0, 0, 0.55)" },
});
