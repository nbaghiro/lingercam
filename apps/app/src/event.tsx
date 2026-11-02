import { normalizeJoinCode } from "@linger/core/events";
import { canShoot, type GalleryItem } from "@linger/core/shots";
import Constants from "expo-constants";
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import {
    ActivityIndicator,
    FlatList,
    Modal,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    Share,
    StyleSheet,
    View,
} from "react-native";
import Animated, {
    Easing,
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { endActivity } from "@/activity";
import {
    api,
    asApiError,
    currentHostId,
    joinLink,
    PUSH_KEY,
    storage,
    useLoad,
    useSession,
    type ApiError,
    type Event,
    type EventSummary,
    type GalleryPage,
    type Person,
} from "@/api";
import { dayLabel, formatCount, formatDuration, formatTime, t } from "@/copy";
import { savePhoto } from "@/save";
import {
    Button,
    Cover,
    IconButton,
    InviteCard,
    Notice,
    Screen,
    Sheet,
    Stats,
    Text,
    Tile,
    color,
    gutter,
    icons,
    type Stat,
} from "@/ui";
import { dismissFailed, useShots } from "@/uploads";

// The gallery is kept per join code outside React, so the photo viewer and the recap page
// through the same photos the event screen loaded.

export interface GalleryState {
    /** The latest first page: counts before the reveal, photos after. */
    first: GalleryPage | undefined;
    items: GalleryItem[];
    cursor: string | null;
    loading: boolean;
    error: ApiError | null;
}

const EMPTY: GalleryState = {
    first: undefined,
    items: [],
    cursor: null,
    loading: false,
    error: null,
};
const galleries = new Map<string, GalleryState>();
const galleryListeners = new Set<() => void>();

function setGallery(code: string, patch: Partial<GalleryState>): void {
    galleries.set(code, { ...(galleries.get(code) ?? EMPTY), ...patch });
    for (const listener of galleryListeners) listener();
}

// Each refresh starts a new generation; a page that arrives for an older one is dropped, so a
// slow "load more" can't write stale photos and an old cursor over a fresh first page.
const generations = new Map<string, number>();

/** Loads the first page again, replacing what was loaded. */
export async function refreshGallery(code: string): Promise<void> {
    const generation = (generations.get(code) ?? 0) + 1;
    generations.set(code, generation);
    setGallery(code, { loading: true });
    try {
        const page = await api.guest.gallery(code);
        if (generations.get(code) !== generation) return;
        if (page.kind === "photos") endActivity(code).catch(() => null);
        setGallery(code, {
            first: page,
            items: page.kind === "photos" ? page.items : [],
            cursor: page.kind === "photos" ? page.nextCursor : null,
            loading: false,
            error: null,
        });
    } catch (error) {
        if (generations.get(code) !== generation) return;
        setGallery(code, { loading: false, error: asApiError(error) });
    }
}

/** Loads the next page of photos, if there is one. */
export async function loadMoreGallery(code: string): Promise<void> {
    const start = galleries.get(code) ?? EMPTY;
    if (start.loading || !start.cursor) return;
    const generation = generations.get(code) ?? 0;
    setGallery(code, { loading: true });
    try {
        const page = await api.guest.gallery(code, start.cursor);
        if (generations.get(code) !== generation) return;
        if (page.kind !== "photos") {
            setGallery(code, { first: page, items: [], cursor: null, loading: false });
            return;
        }
        const current = galleries.get(code) ?? EMPTY;
        const seen = new Set(current.items.map((item) => item.id));
        setGallery(code, {
            items: [...current.items, ...page.items.filter((item) => !seen.has(item.id))],
            cursor: page.nextCursor,
            loading: false,
            error: null,
        });
    } catch (error) {
        if (generations.get(code) !== generation) return;
        setGallery(code, { loading: false, error: asApiError(error) });
    }
}

/** Loads every page. Used before saving all photos. */
export async function loadWholeGallery(code: string): Promise<GalleryItem[]> {
    for (let guard = 0; guard < 200; guard++) {
        const state = galleries.get(code) ?? EMPTY;
        if (!state.cursor) return state.items;
        await loadMoreGallery(code);
        if ((galleries.get(code) ?? EMPTY).error) break;
    }
    return (galleries.get(code) ?? EMPTY).items;
}

/** Changes one photo in place, such as after a like. */
export function patchPhoto(code: string, id: string, patch: Partial<GalleryItem>): void {
    const state = galleries.get(code) ?? EMPTY;
    setGallery(code, {
        items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
}

export function useGallery(code: string): GalleryState {
    return useSyncExternalStore(
        (listener) => {
            galleryListeners.add(listener);
            return () => galleryListeners.delete(listener);
        },
        () => galleries.get(code) ?? EMPTY,
        () => galleries.get(code) ?? EMPTY,
    );
}

/** The join code from the route, tidied the way core normalises codes typed by hand. */
export function useCode(): string {
    const params = useLocalSearchParams<{ code: string }>();
    return normalizeJoinCode(params.code ?? "") ?? params.code ?? "";
}

/** The host's own event for this code, when the signed-in host owns it. */
export function useHostEvent(code: string): Event | undefined {
    const session = useSession();
    const events = useLoad(session ? `host-events:${session.host.id}` : null, () =>
        api.events.list(),
    );
    return events.data?.find((event) => event.code === code);
}

// Notifications. The app schedules a local one for the reveal, which needs no keys, and registers
// for push so the server can tell everyone at once.

if (Platform.OS !== "web") {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: true,
            shouldSetBadge: false,
        }),
    });
}

async function registerPush(): Promise<void> {
    const projectId: unknown =
        Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    // Expo push tokens need an EAS project. Until there is one, the local reminder is enough.
    if (typeof projectId !== "string") return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const owner = `${data}|${currentHostId() ?? ""}`;
    if (storage.getString(PUSH_KEY) === owner) return;
    await api.push(data);
    storage.set(PUSH_KEY, owner);
}

async function remindAtReveal(summary: EventSummary): Promise<void> {
    const at = Date.parse(summary.revealsAt);
    if (Platform.OS === "web" || summary.revealMode === "right-away" || at <= Date.now()) return;
    const key = `reminder:${summary.code}`;
    if (storage.getString(key) === summary.revealsAt) return;
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return;
    const identifier = `reveal-${summary.code}`;
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => null);
    await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
            title: t("notify.revealTitle", { title: summary.title }),
            body: t("notify.revealBody"),
            data: { url: `/e/${summary.code}` },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    });
    storage.set(key, summary.revealsAt);
    await registerPush().catch(() => null);
}

/** Opens the event when someone taps its reveal notification. Used once, in the root layout. */
export function useRevealLinks(): void {
    const router = useRouter();
    useEffect(() => {
        if (Platform.OS === "web") return;
        const open = (response: Notifications.NotificationResponse | null) => {
            const data = response?.notification.request.content.data;
            const url: unknown = data?.url;
            const code: unknown = data?.code;
            if (typeof url === "string" && url.startsWith("/e/")) router.push(url as Href);
            else if (typeof code === "string" && normalizeJoinCode(code)) {
                router.push(`/e/${normalizeJoinCode(code)}` as Href);
            }
        };
        open(Notifications.getLastNotificationResponse());
        const subscription = Notifications.addNotificationResponseReceivedListener(open);
        return () => subscription.remove();
    }, [router]);
}

export async function shareLink(title: string, url: string, message: string): Promise<void> {
    if (Platform.OS === "web") {
        if (navigator.share) await navigator.share({ title, url });
        else await navigator.clipboard?.writeText(url);
        return;
    }
    await Share.share({ message, ...(Platform.OS === "ios" ? { url } : {}) });
}

// The event screen

const POLL_MS = 30_000;
/** Right-away events show photos while the camera is open; new ones are checked for less often. */
const LIVE_POLL_MS = 60_000;
const MAX_DEVELOPING = 40;
// Developing tiles show different parts of the blurred cover, so the grid doesn't repeat itself.
const SHIFTS = [
    { x: 30, y: 10 },
    { x: -30, y: -20 },
    { x: 10, y: 35 },
    { x: -20, y: 25 },
    { x: 25, y: -30 },
    { x: -5, y: 0 },
];

type Row =
    { kind: "developing"; key: string; index: number } | { kind: "photo"; item: GalleryItem };

export function EventScreen() {
    const code = useCode();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const gallery = useGallery(code);
    const [round, setRound] = useState(0);
    const people = useLoad(`people:${code}:${round}`, () => api.guest.people(code));
    const shots = useShots(code);
    const [now, setNow] = useState(() => new Date());
    const [inviting, setInviting] = useState(false);
    const [showPeople, setShowPeople] = useState(false);
    const [roll, setRoll] = useState<Person | null>(null);
    const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
    const [saved, setSaved] = useState<number | null>(null);
    const [momentSeen, setMomentSeen] = useState(
        () => storage.getBoolean(`moment:${code}`) ?? false,
    );

    const refresh = () => {
        refreshGallery(code).catch(() => null);
        setRound((n) => n + 1);
        setNow(new Date());
    };

    useEffect(() => {
        refreshGallery(code).catch(() => null);
    }, [code, shots.pending]);

    const first = gallery.first;
    const developing = first?.kind === "developing";
    const photos = first?.kind === "photos";
    const shooting = summary.data !== undefined && canShoot(summary.data, now);

    // Poll while photos are developing, and slowly while a right-away event is still shooting.
    // The summary is reloaded too, so the state and the stats move with the gallery.
    const pollMs = developing ? POLL_MS : photos && shooting ? LIVE_POLL_MS : null;
    const tick = useEffectEvent(() => {
        refreshGallery(code).catch(() => null);
        summary.reload();
        setNow(new Date());
    });
    useEffect(() => {
        if (pollMs === null) return;
        const id = setInterval(tick, pollMs);
        return () => clearInterval(id);
    }, [pollMs]);

    // When the reveal lands while the screen is open, the summary catches up at once.
    const lastKind = useRef(first?.kind);
    const reloadSummary = useEffectEvent(() => summary.reload());
    useEffect(() => {
        if (lastKind.current === "developing" && first?.kind === "photos") reloadSummary();
        lastKind.current = first?.kind;
    }, [first?.kind]);

    useEffect(() => {
        if (gallery.error?.code === "not-joined") router.replace(`/j/${code}` as Href);
    }, [code, gallery.error, router]);

    useEffect(() => {
        if (summary.data && developing) remindAtReveal(summary.data).catch(() => null);
    }, [summary.data, developing]);

    const event = summary.data;
    if (!event) {
        return (
            <Screen>
                {summary.error ? (
                    <View style={styles.center}>
                        <Notice>
                            {summary.error.code === "not-found"
                                ? t("join.notFound")
                                : t("event.loadFailed")}
                        </Notice>
                        <Button label={t("common.retry")} variant="dark" onPress={summary.reload} />
                    </View>
                ) : (
                    <ActivityIndicator color={color.ash} style={{ marginTop: 120 }} />
                )}
            </Screen>
        );
    }

    const tz = event.timeZone;
    const endsAt = Date.parse(event.endsAt);
    const revealsAt = Date.parse(event.revealsAt);
    // Photos with the camera closed means the reveal has happened, even before the summary says so.
    const revealed =
        event.state === "revealed" || event.state === "archived" || (photos && !shooting);
    const items = first?.kind === "photos" ? gallery.items : [];

    if (photos && revealed && !momentSeen && items.length > 0) {
        return (
            <Moment
                items={items}
                total={first.total}
                photographers={first.photographers}
                onDone={() => {
                    storage.set(`moment:${code}`, true);
                    setMomentSeen(true);
                }}
            />
        );
    }

    const time: Stat = revealed
        ? { value: t("event.revealed"), label: dayLabel(new Date(revealsAt), now, tz) }
        : shooting
          ? { value: formatDuration(endsAt - now.getTime()), label: t("event.left") }
          : { value: formatDuration(revealsAt - now.getTime()), label: t("event.toReveal") };
    const peopleCount = people.data?.people.length ?? event.guestCount;

    const shown = roll ? items.filter((item) => item.photographer.id === roll.id) : items;
    const developingCount = first?.kind === "developing" ? first.total : 0;
    const rows: Row[] = photos
        ? shown.map((item) => ({ kind: "photo", item }))
        : Array.from({ length: Math.min(developingCount, MAX_DEVELOPING) }, (_, index) => ({
              kind: "developing",
              key: `d${index}`,
              index,
          }));

    const saveAll = async () => {
        const all = await loadWholeGallery(code);
        setSaved(null);
        setSaving({ done: 0, total: all.length });
        let done = 0;
        for (const item of all) {
            try {
                await savePhoto(item.url);
                done += 1;
                setSaving({ done, total: all.length });
            } catch {
                break;
            }
        }
        setSaving(null);
        setSaved(done);
    };

    const primary = shooting
        ? {
              icon: icons.camera,
              label: t("event.openCamera"),
              run: () => router.push(`/e/${code}/camera` as Href),
          }
        : photos && items.length > 0
          ? {
                icon: icons.play,
                label: t("event.recap"),
                run: () => router.push(`/e/${code}/recap` as Href),
            }
          : { icon: icons.camera, label: t("event.openCamera"), run: undefined };

    const header = (
        <View>
            <Cover source={event.coverUrl} title={event.title}>
                <Stats
                    items={[
                        { value: formatCount(first?.total ?? 0), label: t("event.moments") },
                        time,
                        {
                            value: formatCount(peopleCount),
                            label: t("event.people"),
                            onPress: () => setShowPeople(true),
                        },
                    ]}
                />
            </Cover>
            {router.canGoBack() ? (
                <IconButton
                    icon={icons.back}
                    variant="glass"
                    onPress={() => router.back()}
                    accessibilityLabel={t("common.back")}
                    style={[styles.back, { top: insets.top + 8 }]}
                />
            ) : null}
            <View style={styles.actions}>
                <Button
                    icon={primary.icon}
                    accessibilityLabel={primary.label}
                    size="compact"
                    style={{ flex: 1 }}
                    disabled={!primary.run}
                    {...(primary.run ? { onPress: primary.run } : {})}
                />
                <IconButton
                    icon={icons.qr}
                    onPress={() => setInviting(true)}
                    accessibilityLabel={t("event.showCode")}
                />
                <IconButton
                    icon={icons.download}
                    onPress={() => {
                        saveAll().catch(() => setSaving(null));
                    }}
                    disabled={!photos || items.length === 0 || saving !== null}
                    accessibilityLabel={t("event.download")}
                />
            </View>
            {saving ? (
                <Text variant="caption" tone="ash" align="center" style={styles.line}>
                    {t("event.downloading", saving)}
                </Text>
            ) : saved !== null ? (
                <Text variant="caption" tone="ash" align="center" style={styles.line}>
                    {t("event.downloaded", { count: saved })}
                </Text>
            ) : null}
            {shots.failed > 0 ? (
                <Pressable onPress={() => dismissFailed(code)} accessibilityRole="button">
                    <Text variant="caption" tone="ash" align="center" style={styles.line}>
                        {t("uploads.failed", { count: shots.failed })}
                    </Text>
                </Pressable>
            ) : null}
            {shots.pending > 0 ? (
                <Text variant="caption" tone="ash" align="center" style={styles.line}>
                    {shots.retrying
                        ? t("uploads.retrying")
                        : t("uploads.pending", { count: shots.pending })}
                </Text>
            ) : null}
            {roll ? (
                <View style={styles.roll}>
                    <Text variant="name">{t("event.roll", { name: roll.name })}</Text>
                    <Pressable onPress={() => setRoll(null)} accessibilityRole="button" hitSlop={8}>
                        <Text variant="small" tone="ash">
                            {t("event.everyone")}
                        </Text>
                    </Pressable>
                </View>
            ) : null}
            {first && rows.length === 0 ? (
                <Text variant="small" tone="ash" align="center" style={styles.empty}>
                    {photos
                        ? t("event.emptyRevealed")
                        : shooting
                          ? t("event.empty")
                          : t("event.emptyClosed")}
                </Text>
            ) : null}
            {gallery.error && gallery.error.code !== "not-joined" ? (
                <Notice>{t("event.loadFailed")}</Notice>
            ) : null}
        </View>
    );

    const extra = developingCount - MAX_DEVELOPING;

    return (
        <View style={styles.screen}>
            <FlatList
                data={rows}
                keyExtractor={(row) => (row.kind === "photo" ? row.item.id : row.key)}
                numColumns={2}
                columnWrapperStyle={styles.columns}
                ItemSeparatorComponent={Gap}
                ListHeaderComponent={header}
                ListFooterComponent={
                    <View style={{ paddingBottom: insets.bottom + 16, paddingTop: 12 }}>
                        {!photos && extra > 0 ? (
                            <Text variant="small" tone="ash" align="center" serif italic>
                                {t("event.more", { count: extra })}
                            </Text>
                        ) : null}
                        {gallery.loading && gallery.cursor ? (
                            <ActivityIndicator color={color.ash} />
                        ) : null}
                    </View>
                }
                onEndReached={() => {
                    loadMoreGallery(code).catch(() => null);
                }}
                onEndReachedThreshold={0.6}
                refreshControl={
                    <RefreshControl
                        refreshing={false}
                        onRefresh={() => {
                            summary.reload();
                            refresh();
                        }}
                        tintColor={color.ash}
                    />
                }
                renderItem={({ item: row }) =>
                    row.kind === "photo" ? (
                        <Tile
                            source={row.item.thumbUrl}
                            name={row.item.photographer.name}
                            accessibilityLabel={t("event.photoBy", {
                                name: row.item.photographer.name,
                            })}
                            onPress={() => router.push(`/e/${code}/${row.item.id}` as Href)}
                        />
                    ) : (
                        <Tile
                            source={event.coverUrl}
                            developing
                            developingLabel={t("event.developing")}
                            shift={SHIFTS[row.index % SHIFTS.length] ?? { x: 0, y: 0 }}
                        />
                    )
                }
                showsVerticalScrollIndicator={false}
            />
            <InviteSheet
                visible={inviting}
                onClose={() => setInviting(false)}
                code={code}
                title={event.title}
            />
            <People
                visible={showPeople}
                onClose={() => setShowPeople(false)}
                people={people.data?.people ?? []}
                items={items}
                revealed={photos}
                timeZone={tz}
                onPick={(person) => {
                    setRoll(person);
                    setShowPeople(false);
                }}
            />
        </View>
    );
}

function Gap() {
    return <View style={{ height: 6 }} />;
}

// The reveal moment: three photos fanned out, shown once on each device.

function FanCard({ uri, index, open }: { uri: string; index: number; open: SharedValue<number> }) {
    const side = index - 1;
    const style = useAnimatedStyle(() => ({
        transform: [
            { translateX: side * (26 + 66 * open.value) },
            { translateY: Math.abs(side) * 18 * open.value },
            { rotate: `${side * (5 + 6 * open.value)}deg` },
        ],
    }));
    return (
        <Animated.View style={[styles.fanCard, style]}>
            <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" />
        </Animated.View>
    );
}

function Moment({
    items,
    total,
    photographers,
    onDone,
}: {
    items: GalleryItem[];
    total: number;
    photographers: number;
    onDone: () => void;
}) {
    const open = useSharedValue(0);
    const [opening, setOpening] = useState(false);
    const cards = [items[2], items[1], items[0]].filter((item) => item !== undefined);

    const reveal = () => {
        if (opening) return;
        setOpening(true);
        open.set(withTiming(1, { duration: 900, easing: Easing.bezier(0.2, 0.9, 0.3, 1.15) }));
        setTimeout(onDone, 1300);
    };

    return (
        <Screen footer={<Button label={t("moment.cta")} onPress={reveal} />}>
            <Animated.View entering={FadeIn.duration(500)} style={{ alignItems: "center" }}>
                <Text variant="display" align="center" style={{ marginTop: 20 }}>
                    {t("moment.title")}
                </Text>
                <Text variant="small" tone="ash" align="center" style={{ marginTop: 10 }}>
                    {t("moment.body", { moments: total, people: photographers })}
                </Text>
            </Animated.View>
            <View style={styles.fan}>
                {cards.map((item, i) => (
                    <FanCard
                        key={item.id}
                        uri={item.thumbUrl}
                        index={cards.length === 3 ? i : i + (3 - cards.length) / 2}
                        open={open}
                    />
                ))}
            </View>
        </Screen>
    );
}

// The people sheet

function People({
    visible,
    onClose,
    people,
    items,
    revealed,
    timeZone,
    onPick,
}: {
    visible: boolean;
    onClose: () => void;
    people: Person[];
    items: GalleryItem[];
    revealed: boolean;
    timeZone: string;
    onPick: (person: Person) => void;
}) {
    const insets = useSafeAreaInsets();
    const faces = new Map<string, string>();
    for (const item of items) {
        if (!faces.has(item.photographer.id)) faces.set(item.photographer.id, item.thumbUrl);
    }
    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
            onRequestClose={onClose}
        >
            <View
                style={[
                    styles.screen,
                    { paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 },
                ]}
            >
                <View style={styles.peopleTop}>
                    <IconButton
                        icon={icons.close}
                        onPress={onClose}
                        accessibilityLabel={t("common.close")}
                    />
                </View>
                <ScrollView
                    contentContainerStyle={{
                        paddingHorizontal: gutter,
                        paddingBottom: insets.bottom + 24,
                    }}
                >
                    <Text variant="title" accessibilityRole="header">
                        {t("people.title", { count: people.length })}
                    </Text>
                    <Text variant="small" tone="ash" style={{ marginTop: 6 }}>
                        {revealed ? t("people.body") : t("people.bodyBefore")}
                    </Text>
                    <View style={{ marginTop: 14 }}>
                        {people.map((person) => {
                            const face = faces.get(person.id);
                            return (
                                <Pressable
                                    key={person.id}
                                    onPress={() => onPick(person)}
                                    disabled={!revealed || !face}
                                    accessibilityRole={revealed && face ? "button" : "text"}
                                    accessibilityLabel={`${person.name}, ${t("people.shots", {
                                        count: person.shots,
                                    })}`}
                                    style={({ pressed }) => [
                                        styles.person,
                                        { opacity: pressed ? 0.7 : 1 },
                                    ]}
                                >
                                    {face ? (
                                        <Image
                                            source={face}
                                            style={styles.face}
                                            contentFit="cover"
                                        />
                                    ) : (
                                        <View style={[styles.face, styles.initial]}>
                                            <Text serif variant="name">
                                                {person.name.slice(0, 1).toUpperCase()}
                                            </Text>
                                        </View>
                                    )}
                                    <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text weight="medium" numberOfLines={1}>
                                            {person.name}
                                        </Text>
                                        <Text variant="small" tone="ash" style={styles.joined}>
                                            {t("people.joined", {
                                                time: formatTime(
                                                    new Date(person.joinedAt),
                                                    timeZone,
                                                ),
                                            })}
                                        </Text>
                                    </View>
                                    <Text serif italic style={styles.shots}>
                                        {formatCount(person.shots)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </ScrollView>
            </View>
        </Modal>
    );
}

// The invite sheet, also opened from the camera

export function InviteSheet({
    visible,
    onClose,
    code,
    title,
}: {
    visible: boolean;
    onClose: () => void;
    code: string;
    title: string;
}) {
    const url = joinLink(code);
    return (
        <Sheet visible={visible} onClose={onClose}>
            <InviteCard title={title} url={url} caption={t("create.invite.scan")} size={200} />
            <Button
                label={t("create.invite.share")}
                icon={icons.share}
                variant="dark"
                onPress={() => {
                    shareLink(title, url, t("create.invite.shareMessage", { title, url })).catch(
                        () => null,
                    );
                }}
            />
        </Sheet>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    center: { flex: 1, justifyContent: "center", gap: 12 },
    back: { position: "absolute", left: 16 },
    actions: {
        flexDirection: "row",
        gap: 10,
        paddingTop: 8,
        paddingHorizontal: 12,
        paddingBottom: 10,
    },
    line: { marginBottom: 10, paddingHorizontal: gutter },
    roll: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingHorizontal: gutter,
        paddingTop: 4,
        paddingBottom: 12,
    },
    empty: { paddingHorizontal: 40, paddingVertical: 28 },
    columns: { justifyContent: "space-between", paddingHorizontal: 12 },
    fan: { height: 420, marginTop: 24, marginBottom: 10 },
    fanCard: {
        position: "absolute",
        left: "50%",
        top: 30,
        width: 210,
        marginLeft: -105,
        aspectRatio: 3 / 4,
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: color.tile,
        shadowColor: "#000",
        shadowOpacity: 0.6,
        shadowRadius: 25,
        shadowOffset: { width: 0, height: 24 },
        elevation: 12,
    },
    peopleTop: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16 },
    person: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth * 2,
        borderBottomColor: color.line,
    },
    face: { width: 50, height: 50, borderRadius: 25, backgroundColor: color.raised },
    initial: { alignItems: "center", justifyContent: "center" },
    joined: { fontSize: 14, lineHeight: 19 },
    shots: { fontSize: 23, lineHeight: 28, color: "#E2DFD8" },
});
