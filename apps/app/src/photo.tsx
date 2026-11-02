import { LOOKS } from "@linger/core/film";
import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, asApiError, useLoad } from "@/api";
import { formatCount, formatTime, t } from "@/copy";
import {
    loadMoreGallery,
    patchPhoto,
    refreshGallery,
    useCode,
    useGallery,
    useHostEvent,
} from "@/event";
import { PhotosDenied, savePhoto, sharePhoto } from "@/save";
import { Button, IconButton, Notice, Scrim, Text, color, confirm, icons } from "@/ui";

const SHADE = [
    [0, 0.45],
    [0.22, 0],
    [0.58, 0],
    [1, 0.8],
] as const;

/** The full-screen viewer, paging through the photos the event screen loaded. */
export function PhotoScreen() {
    const code = useCode();
    const params = useLocalSearchParams<{ photo: string }>();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const gallery = useGallery(code);
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const host = useHostEvent(code);
    const [current, setCurrent] = useState(params.photo ?? "");
    const [note, setNote] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const items = gallery.items;
    const index = items.findIndex((item) => item.id === current);
    const item = items[index];

    // Opened from a link: load the gallery, then keep paging until the photo turns up.
    useEffect(() => {
        if (!gallery.first && !gallery.loading && !gallery.error) {
            refreshGallery(code).catch(() => null);
        } else if (index < 0 && gallery.cursor && !gallery.loading) {
            loadMoreGallery(code).catch(() => null);
        }
    }, [code, gallery.first, gallery.loading, gallery.error, gallery.cursor, index]);

    useEffect(() => () => clearTimeout(noteTimer.current), []);

    const say = (text: string) => {
        setNote(text);
        clearTimeout(noteTimer.current);
        noteTimer.current = setTimeout(() => setNote(null), 2600);
    };

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace(`/e/${code}` as Href);
    };

    const missing =
        !item && gallery.first !== undefined && !gallery.loading && gallery.cursor === null;

    if (!item) {
        return (
            <View style={[styles.screen, styles.center]}>
                {missing || gallery.error ? <Notice>{t("photo.missing")}</Notice> : null}
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

    const like = async () => {
        const liked = !item.likedByMe;
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
            say(t("photo.saved"));
        } catch (error) {
            say(error instanceof PhotosDenied ? t("photo.allowPhotos") : t("photo.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const report = () => {
        confirm(t("photo.reportTitle"), t("photo.reportBody"), t("photo.report"), () => {
            api.shots
                .report(item.id)
                .then(() => say(t("photo.reported")))
                .catch(() => say(t("photo.reportFailed")));
        });
    };

    const toggleHidden = async () => {
        try {
            const shot = await api.shots.hide(item.id, !item.hidden);
            patchPhoto(code, item.id, { hidden: shot.hidden });
        } catch (error) {
            say(asApiError(error).message);
        }
    };

    return (
        <View style={styles.screen}>
            <FlatList
                data={items}
                horizontal
                pagingEnabled
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
                    loadMoreGallery(code).catch(() => null);
                }}
                renderItem={({ item: photo }) => (
                    <Photo photo={photo} width={width} height={height} />
                )}
            />
            <Scrim stops={SHADE} tint="#000000" />

            <View style={[styles.top, { top: insets.top + 8 }]}>
                <IconButton
                    icon={icons.back}
                    variant="glass"
                    onPress={leave}
                    accessibilityLabel={t("common.back")}
                />
                <Text variant="small" style={styles.position}>
                    {t("photo.position", { index: index + 1, total })}
                </Text>
                <View style={styles.right}>
                    {host ? (
                        <IconButton
                            icon={item.hidden ? icons.show : icons.hide}
                            variant="glass"
                            onPress={() => {
                                toggleHidden().catch(() => null);
                            }}
                            accessibilityLabel={item.hidden ? t("photo.unhide") : t("photo.hide")}
                        />
                    ) : (
                        <IconButton
                            icon={icons.report}
                            variant="glass"
                            onPress={report}
                            accessibilityLabel={t("photo.report")}
                        />
                    )}
                    <IconButton
                        icon={icons.share}
                        variant="glass"
                        onPress={() => {
                            sharePhoto(item.url).catch(() => null);
                        }}
                        accessibilityLabel={t("photo.share")}
                    />
                </View>
            </View>

            <View style={[styles.bottom, { bottom: Math.max(insets.bottom, 12) + 16 }]}>
                <View>
                    <Text serif italic style={styles.who} numberOfLines={1}>
                        {item.photographer.name}
                    </Text>
                    <Text variant="small" tone="soft" style={{ marginTop: 4 }}>
                        {look ? t("photo.meta", { time, look }) : time}
                    </Text>
                    {item.hidden ? (
                        <Text variant="small" tone="candle" style={{ marginTop: 4 }}>
                            {t("photo.hidden")}
                        </Text>
                    ) : null}
                </View>
                {note ? (
                    <Text variant="small" tone="paper" align="center" style={styles.note}>
                        {note}
                    </Text>
                ) : null}
                <View style={styles.acts}>
                    <Button
                        variant="glass"
                        icon={icons.heart}
                        label={formatCount(item.likes)}
                        accessibilityLabel={`${t("photo.like")}, ${formatCount(item.likes)}`}
                        onPress={() => {
                            like().catch(() => null);
                        }}
                        iconWeight={item.likedByMe ? "fill" : "regular"}
                        style={{ flex: 1 }}
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
        </View>
    );
}

function Photo({ photo, width, height }: { photo: GalleryItem; width: number; height: number }) {
    const landscape = photo.width > photo.height;
    return (
        <View style={{ width, height, backgroundColor: color.night }}>
            <Image
                source={photo.url}
                placeholder={photo.thumbUrl}
                style={StyleSheet.absoluteFill}
                contentFit={landscape ? "contain" : "cover"}
                transition={150}
                accessibilityLabel={t("event.photoBy", { name: photo.photographer.name })}
            />
        </View>
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
    position: { color: "#E5E2DB" },
    right: { flexDirection: "row", gap: 10 },
    bottom: { position: "absolute", left: 0, right: 0, paddingHorizontal: 22, gap: 18 },
    who: { fontSize: 32, lineHeight: 35, color: color.paper },
    note: {
        alignSelf: "center",
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: color.glass,
    },
    acts: { flexDirection: "row", gap: 10 },
});
