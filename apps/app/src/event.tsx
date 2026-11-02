import { normalizeJoinCode } from "@linger/core/events";
import { canShoot, type GalleryItem } from "@linger/core/shots";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, storage, useLoad, useSession, type Event, type Person } from "@/api";
import { dayLabel, formatCount, formatDuration, t } from "@/copy";
import { loadMoreGallery, loadWholeGallery, refreshGallery, useGallery } from "@/gallery";
import { InviteSheet } from "@/invite";
import { HostRow, ManageButton } from "@/manage";
import { Moment } from "@/moment";
import { remindAtReveal } from "@/notify";
import { People } from "@/people";
import { saveAll as saveAllPhotos } from "@/save";
import {
    Button,
    Cover,
    IconButton,
    Notice,
    Screen,
    Stats,
    Text,
    Tile,
    color,
    gutter,
    icons,
    type Stat,
} from "@/ui";
import { dismissFailed, useShots } from "@/uploads";

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
        const done = await saveAllPhotos(
            all.map((item) => item.url),
            (count) => setSaving({ done: count, total: all.length }),
        );
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
                <ManageButton summary={event} onChanged={summary.reload} />
            </View>
            <HostRow summary={event} onChanged={summary.reload} />
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
});
