import { normalizeJoinCode } from "@linger/core/events";
import { shootingPhase, type GalleryItem } from "@linger/core/shots";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
    ActivityIndicator,
    AppState,
    FlatList,
    Platform,
    Pressable,
    RefreshControl,
    StyleSheet,
    View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    api,
    joinLink,
    serverNow,
    storage,
    useLoad,
    useOnForeground,
    useSession,
    type Event,
    type GalleryPage,
} from "@/api";
import {
    dayLabel,
    formatCount,
    formatCountdown,
    formatWhen,
    momentsFromPeople,
    problem,
    revealLabel,
    revealModeLabel,
    t,
} from "@/copy";
import {
    loadMoreGallery,
    refreshGallery,
    saveAllLine,
    saveWholeGallery,
    showRoll,
    stopSaving,
    useFreshGallery,
    useGallery,
    useRoll,
    useSaveAll,
} from "@/gallery";
import { InviteSheet, shareLink } from "@/invite";
import { HostRow, ManageButton } from "@/manage";
import { Moment, type TileTarget } from "@/moment";
import { EmailCard, NotifyCard, cancelReminder, remindAtReveal, useEventOnScreen } from "@/notify";
import { People } from "@/people";
import { openPhotoSettings } from "@/save";
import {
    Button,
    CHROME_SCALE,
    Cover,
    Icon,
    IconButton,
    Notice,
    Screen,
    Stats,
    Text,
    Tile,
    color,
    grid,
    gutter,
    icons,
    photoSource,
    radius,
    space,
    useReduceMotion,
    useTileWidth,
    type Stat,
} from "@/ui";
import { dismissFailed, saveRefused, useShots } from "@/uploads";

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

const WEB = Platform.OS === "web";
const POLL_MS = 30_000;
/** After the reveal, how often and for how long the gallery checks for this device's late photos. */
const CATCH_UP_POLL_MS = 4_000;
const CATCH_UP_MS = 30_000;
/** Polling in the last minute before the reveal and until the photos arrive. */
const REVEAL_POLL_MS = 5_000;
/** The server's reveal job gets this long before the screen asks for the photos. */
const REVEAL_GRACE_MS = 3_000;
const MAX_DEVELOPING = 40;
/** Two caption lines, so upload and saving lines never move the grid. */
const STATUS_HEIGHT = 40;

/**
 * The time by the server's clock, ticking every minute in step with the nearest boundary and
 * every second in the last minute before it, so countdowns change when their text does.
 */
function useNow(boundaries: readonly number[]): Date {
    const [now, setNow] = useState(() => serverNow());
    const key = boundaries.join(",");
    useEffect(() => {
        const ms = now.getTime();
        const next = key
            .split(",")
            .map(Number)
            .filter((b) => Number.isFinite(b) && b > ms)
            .sort((a, b) => a - b)[0];
        let delay = 60_000 - (ms % 60_000);
        if (next !== undefined) {
            const left = next - ms;
            delay = left <= 61_000 ? 1000 - (ms % 1000) : left % 60_000 || 60_000;
        }
        const id = setTimeout(() => setNow(serverNow()), Math.max(delay, 50));
        return () => clearTimeout(id);
    }, [now, key]);
    return now;
}

/** Upload progress over an offline spell: how many were waiting, for "All 12 of your photos are in." */
interface Spell {
    last: number;
    peak: number;
    offline: boolean;
    allIn: number | null;
}

type Row =
    | { kind: "developing"; key: string; index: number; name: string | undefined }
    | { kind: "photo"; item: GalleryItem };

export function EventScreen() {
    const code = useCode();
    const { manage: manageParam } = useLocalSearchParams<{ manage?: string }>();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReduceMotion();
    const tileWidth = useTileWidth();
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const gallery = useGallery(code);
    const people = useLoad(`people:${code}`, () => api.guest.people(code));
    const hostEvent = useHostEvent(code);
    const shots = useShots(code);
    const [inviting, setInviting] = useState(false);
    const [showPeople, setShowPeople] = useState(false);
    const roll = useRoll(code);
    const rollGallery = useGallery(code, roll?.id);
    const saveRun = useSaveAll(code);
    const [refreshing, setRefreshing] = useState(false);
    const [headerHeight, setHeaderHeight] = useState(0);
    const [momentSeen, setMomentSeen] = useState(
        () => storage.getBoolean(`moment:${code}`) ?? false,
    );
    const [returnedSeen, setReturnedSeen] = useState(
        () => storage.getNumber(`returnedSeen:${code}`) ?? 0,
    );
    const [refusedDenied, setRefusedDenied] = useState(false);
    // Photos sent after the reveal are still developing when the queue empties.
    const catchUpUntil = shots.drained > 0 ? shots.drained + CATCH_UP_MS : 0;

    const event = summary.data;
    const role = event?.viewer.role ?? "none";
    const me = useLoad(role === "none" ? null : `me:${code}`, () => api.guest.me(code));

    const endsAt = event ? Date.parse(event.endsAt) : NaN;
    const startsAt = event ? Date.parse(event.startsAt) : NaN;
    const revealsAt = event ? Date.parse(event.revealsAt) : NaN;
    const now = useNow([startsAt, endsAt, revealsAt, catchUpUntil]);

    const first = gallery.first;
    const developing = first?.kind === "developing";
    const photos = first?.kind === "photos";
    const phase = event ? shootingPhase(event, now) : "closed";
    const shooting = phase === "open";
    const rightAway = event?.revealMode === "right-away";
    // Revealed once the photos are here and the camera has closed; until then the stat says "Now".
    const revealed =
        photos && !shooting
            ? true
            : first === undefined && (event?.state === "revealed" || event?.state === "archived");

    const reloadAll = () => {
        refreshGallery(code).catch(() => null);
        summary.reload();
    };
    // Polls skip a backgrounded app or tab; coming back to the foreground reloads at once.
    const tick = useEffectEvent(() => {
        if (AppState.currentState !== "active") return;
        reloadAll();
    });

    // The gallery reloads whenever the screen comes into view or the app comes back, so late
    // photos slot in and signed URLs are fresh.
    useFocusEffect(
        useCallback(() => {
            refreshGallery(code).catch(() => null);
        }, [code]),
    );
    useOnForeground(() => {
        reloadAll();
        setRefusedDenied(false);
    });
    useFreshGallery(code);
    useFreshGallery(code, roll?.id);
    useEffect(() => {
        if (roll) refreshGallery(code, roll.id).catch(() => null);
    }, [code, roll]);
    useEventOnScreen(code, reloadAll);

    // Polling. Developing: every 30 s, then every 5 s from a minute before the reveal until the
    // photos arrive. A right-away event that is shooting checks for new photos every 30 s.
    // After the reveal, photos this device just sent are still developing when the queue drains,
    // so the gallery checks every few seconds for a while until they're all there.
    const nearReveal = revealsAt - now.getTime() <= 60_000;
    const lateMine =
        photos && first?.kind === "photos" && event
            ? Math.max(0, event.viewer.shotsTaken - first.mine)
            : 0;
    const catchingUp = lateMine > 0 && shots.pending === 0 && now.getTime() < catchUpUntil;
    const pollMs = developing
        ? nearReveal
            ? REVEAL_POLL_MS
            : POLL_MS
        : catchingUp
          ? CATCH_UP_POLL_MS
          : photos && shooting
            ? POLL_MS
            : null;
    useEffect(() => {
        if (pollMs === null) return;
        const id = setInterval(tick, pollMs);
        return () => clearInterval(id);
    }, [pollMs]);

    // One refresh just after the reveal, so the moment doesn't wait for the next poll.
    useEffect(() => {
        if (!Number.isFinite(revealsAt) || photos) return;
        const wait = revealsAt + REVEAL_GRACE_MS - serverNow().getTime();
        if (wait < 0) return;
        const id = setTimeout(tick, wait);
        return () => clearTimeout(id);
    }, [revealsAt, photos]);

    // When the reveal lands while the screen is open, the summary catches up at once.
    const lastKind = useRef(first?.kind);
    useEffect(() => {
        if (lastKind.current === "developing" && first?.kind === "photos") tick();
        lastKind.current = first?.kind;
    }, [first?.kind]);

    // Each photo this device finishes sending shows up without a pull to refresh.
    const lastPending = useRef(shots.pending);
    useEffect(() => {
        if (shots.pending < lastPending.current) tick();
        lastPending.current = shots.pending;
    }, [shots.pending]);
    useEffect(() => {
        if (shots.drained > 0) tick();
    }, [shots.drained]);

    const [spell, setSpell] = useState<Spell>({
        last: shots.pending,
        peak: 0,
        offline: false,
        allIn: null,
    });
    if (shots.pending !== spell.last || (shots.retrying && !spell.offline && shots.pending > 0)) {
        if (shots.pending > 0) {
            setSpell({
                last: shots.pending,
                peak: Math.max(spell.peak, shots.pending),
                offline: spell.offline || shots.retrying,
                allIn: null,
            });
        } else {
            setSpell({
                last: 0,
                peak: 0,
                offline: false,
                allIn: spell.offline && spell.peak > 0 ? spell.peak : null,
            });
        }
    }

    useEffect(() => {
        if (gallery.error?.code === "not-joined") router.replace(`/j/${code}` as Href);
    }, [code, gallery.error, router]);

    // A reminder only when notifications are already allowed; the card asks otherwise.
    const remind = useEffectEvent(() => {
        if (event && developing) remindAtReveal(event).catch(() => null);
    });
    useEffect(() => {
        remind();
    }, [event?.revealsAt, developing]);

    const offline = gallery.error?.code === "network" || gallery.error?.code === "timeout";
    const gone =
        event !== undefined &&
        (summary.error?.code === "not-found" || gallery.error?.code === "not-found");
    useEffect(() => {
        if (gone) cancelReminder(code).catch(() => null);
    }, [gone, code]);

    const goHome = () => {
        if (router.canGoBack()) router.back();
        else router.replace("/" as Href);
    };

    if (!event || gone) {
        return (
            <Screen>
                {gone ? (
                    <View style={styles.center}>
                        <Notice>{t("event.gone")}</Notice>
                        <Button
                            label={t("event.backToEvents")}
                            variant="dark"
                            onPress={() => router.replace("/" as Href)}
                        />
                    </View>
                ) : summary.error ? (
                    <View style={styles.center}>
                        <Notice>
                            {summary.error.code === "not-found"
                                ? problem("not-found")
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

    const items = first?.kind === "photos" ? gallery.items : [];
    const host = role === "host";
    const member = role !== "none";
    const viewer = event.viewer;

    const momentCandidate = photos && revealed && !rightAway && !momentSeen && items.length > 0;

    const time: Stat =
        rightAway && shooting
            ? { value: t("event.live"), label: revealModeLabel("right-away") }
            : revealed
              ? { value: t("event.revealed"), label: dayLabel(new Date(revealsAt), now) }
              : shooting
                ? { value: formatCountdown(endsAt - now.getTime()), label: t("event.left") }
                : { value: formatCountdown(revealsAt - now.getTime()), label: t("event.toReveal") };
    // The count from the polled summary, plus the host, as the people sheet lists them.
    const peopleCount = event.guestCount + 1;
    // A gallery that failed falls back to the summary's count instead of a "0" that isn't real.
    const momentCount = first?.total ?? event.photoCount;

    const shown = roll ? rollGallery.items : items;
    const developingCount = first?.kind === "developing" ? first.total : 0;
    const names = first?.kind === "developing" ? first.names : [];
    const rows: Row[] = photos
        ? shown.map((item) => ({ kind: "photo", item }))
        : Array.from({ length: Math.min(developingCount, MAX_DEVELOPING) }, (_, index) => ({
              kind: "developing",
              key: `d${index}`,
              index,
              name: names[index],
          }));

    const saving = saveRun.state === "saving";
    const saveLine = saveAllLine(saveRun);

    // The roll line: allowance from the server, shots left counting photos not yet reserved.
    const serverLeft = viewer.shotsLeft;
    const left = shots.left === undefined ? serverLeft : shots.left;
    const taken =
        serverLeft === null || left === null
            ? viewer.shotsTaken + shots.pending
            : viewer.shotsTaken + serverLeft - left;
    const showRollLine = !revealed && (role === "guest" || (host && taken > 0));
    const hasPhoto = taken > 0 || shots.pending > 0;

    const returned = me.data?.returned ?? 0;
    const dismissReturned = () => {
        storage.set(`returnedSeen:${code}`, returned);
        setReturnedSeen(returned);
    };

    // One status line at a time, in a slot that keeps its height.
    let status: {
        text: string;
        onPress?: () => void;
        action?: { label: string; run: () => void };
    } | null = null;
    if (saveLine !== null) {
        status = {
            text: saveLine,
            ...(saving
                ? { action: { label: t("common.stop"), run: () => stopSaving(code) } }
                : saveRun.state === "denied"
                  ? { action: { label: t("common.openSettings"), run: openPhotoSettings } }
                  : {}),
        };
    } else if (shots.refused > 0 && refusedDenied) {
        status = {
            text: t("save.denied"),
            action: { label: t("common.openSettings"), run: openPhotoSettings },
        };
    } else if (shots.refused > 0) {
        status = {
            text: t(WEB ? "uploads.refusedWeb" : "uploads.refused", { count: shots.refused }),
            action: {
                label: t(WEB ? "uploads.download" : "uploads.save"),
                run: () => {
                    saveRefused(code)
                        .then((left) => setRefusedDenied(!WEB && left > 0))
                        .catch(() => null);
                },
            },
        };
    } else if (shots.keptInPhotos > 0)
        status = {
            text: t(WEB ? "uploads.keptWeb" : "uploads.kept", { count: shots.keptInPhotos }),
        };
    else if (shots.failed > 0) {
        status = {
            text: t("uploads.failed", { count: shots.failed }),
            onPress: () => dismissFailed(code),
        };
    } else if (shots.unreadable > 0) {
        status = { text: t("uploads.unreadable", { count: shots.unreadable }) };
    } else if (returned > returnedSeen) {
        status = {
            text: t("uploads.returned", { count: returned - returnedSeen }),
            onPress: dismissReturned,
        };
    } else if (shots.pending > 0) {
        status = {
            text: revealed
                ? t("uploads.stillSending", { count: shots.pending })
                : shots.retrying
                  ? t("uploads.retrying")
                  : t("uploads.pending", { count: shots.pending }),
        };
    } else if (revealed && catchingUp) {
        status = { text: t("uploads.stillSending", { count: lateMine }) };
    } else if (spell.allIn !== null) {
        status = { text: t("uploads.allIn", { count: spell.allIn }) };
    }
    const statusSlot = member || saveLine !== null;

    const primary: {
        icon: typeof icons.camera;
        label: string;
        run: () => void;
        show: boolean;
    } | null = shooting
        ? {
              icon: icons.camera,
              label: t("event.openCamera"),
              run: () => router.push(`/e/${code}/camera` as Href),
              show: false,
          }
        : photos && items.length > 0
          ? {
                icon: icons.play,
                label: t("event.recap"),
                run: () => router.push(`/e/${code}/recap` as Href),
                show: true,
            }
          : null;
    // With the camera closed and nothing to play, the button's place says what happens next.
    const closedLine =
        primary !== null
            ? null
            : phase === "before"
              ? t("join.opensWhen", { when: formatWhen(now, new Date(startsAt)) })
              : revealed
                ? t("event.revealed")
                : revealsAt > now.getTime()
                  ? revealLabel(now, new Date(revealsAt))
                  : t("revealLabel.future", { when: t("revealWhen.past") });

    const shareEvent = () => {
        const url = joinLink(code);
        shareLink(
            event.title,
            url,
            t("recap.shareMessage", { title: event.title, url }),
            t("recap.shareText", { title: event.title }),
        ).catch(() => null);
    };

    const header = (
        <View onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}>
            <Cover source={event.coverUrl} title={event.title}>
                <Stats
                    items={[
                        { value: formatCount(momentCount), label: t("event.moments") },
                        time,
                        {
                            value: formatCount(peopleCount),
                            label: t("event.people"),
                            onPress: () => {
                                people.reload();
                                setShowPeople(true);
                            },
                        },
                    ]}
                />
            </Cover>
            <IconButton
                icon={icons.back}
                variant="glass"
                onPress={goHome}
                accessibilityLabel={router.canGoBack() ? t("common.back") : t("event.backToEvents")}
                style={[styles.back, { top: insets.top + 8 }]}
            />
            {rightAway && photos && !shooting && items.length > 0 ? (
                <Text variant="name" align="center" style={styles.night}>
                    {t("event.nightOver", {
                        counts: momentsFromPeople(first.total, first.photographers),
                    })}
                </Text>
            ) : null}
            <View style={styles.actions}>
                {primary ? (
                    <Button
                        icon={primary.icon}
                        {...(primary.show ? { label: primary.label } : {})}
                        accessibilityLabel={primary.label}
                        size="compact"
                        style={{ flex: 1 }}
                        onPress={primary.run}
                    />
                ) : (
                    <View style={styles.closed} accessibilityRole="text">
                        <Text variant="small" tone="ash" align="center" numberOfLines={2}>
                            {closedLine ?? ""}
                        </Text>
                    </View>
                )}
                {revealed ? (
                    <IconButton
                        icon={icons.share}
                        onPress={shareEvent}
                        accessibilityLabel={t("recap.share")}
                    />
                ) : (
                    <IconButton
                        icon={icons.qr}
                        onPress={() => setInviting(true)}
                        accessibilityLabel={t("event.showCode")}
                    />
                )}
                {photos && items.length > 0 ? (
                    <IconButton
                        icon={icons.download}
                        onPress={() => {
                            saveWholeGallery(code, event.title).catch(() => null);
                        }}
                        disabled={saving}
                        accessibilityLabel={t("event.download")}
                    />
                ) : null}
                <ManageButton
                    summary={event}
                    onChanged={summary.reload}
                    openAtStart={manageParam === "1"}
                />
            </View>
            <HostRow summary={event} onChanged={summary.reload} />
            {showRollLine ? (
                <Text variant="caption" tone="ash" align="center" style={styles.rollLine}>
                    {left === null || phase === "closed"
                        ? t("event.yourRollTaken", { taken })
                        : t("event.yourRoll", { taken, left: left ?? 0 })}
                </Text>
            ) : null}
            {statusSlot ? (
                <View style={styles.status}>
                    {status ? (
                        <Pressable
                            onPress={status.onPress}
                            disabled={!status.onPress}
                            accessibilityRole={status.onPress ? "button" : "text"}
                        >
                            <Text
                                variant="caption"
                                tone="ash"
                                align="center"
                                numberOfLines={2}
                                accessibilityLiveRegion="polite"
                            >
                                {status.text}
                            </Text>
                        </Pressable>
                    ) : null}
                    {status?.action ? (
                        <Pressable
                            onPress={status.action.run}
                            accessibilityRole="button"
                            hitSlop={8}
                        >
                            <Text variant="caption" weight="medium" align="center">
                                {status.action.label}
                            </Text>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
            {!revealed && (role === "guest" || host) && (hasPhoto || host) ? (
                <>
                    <NotifyCard event={event} audience={host ? "host" : "guest"} />
                    {role === "guest" && hasPhoto ? <EmailCard event={event} /> : null}
                </>
            ) : null}
            {roll ? (
                <View style={styles.roll}>
                    <Text variant="name">{t("event.roll", { name: roll.name })}</Text>
                    <Pressable
                        onPress={() => showRoll(code, null)}
                        accessibilityRole="button"
                        hitSlop={8}
                    >
                        <Text variant="small" tone="ash">
                            {t("event.everyone")}
                        </Text>
                    </Pressable>
                </View>
            ) : null}
            {first && rows.length === 0 && !(roll && rollGallery.loading) ? (
                <Text variant="small" tone="ash" align="center" style={styles.empty}>
                    {photos
                        ? t("event.emptyRevealed")
                        : shooting
                          ? t("event.empty")
                          : phase === "before"
                            ? t("event.emptyBefore")
                            : t("event.emptyClosed")}
                </Text>
            ) : null}
            {gallery.error && offline && !gallery.loading && revealsAt > now.getTime() ? (
                <View style={styles.error}>
                    <Notice>{t("camera.offline")}</Notice>
                </View>
            ) : gallery.error && gallery.error.code !== "not-joined" && !gallery.loading ? (
                <View style={styles.error}>
                    <Notice>
                        {offline
                            ? t("event.readyOffline")
                            : first
                              ? problem(gallery.error.code)
                              : t("event.loadFailed")}
                    </Notice>
                    <Button
                        label={t("common.retry")}
                        variant="dark"
                        size="compact"
                        onPress={() => {
                            refreshGallery(code).catch(() => null);
                        }}
                    />
                </View>
            ) : null}
            {developingCount > 0 && !photos ? (
                // The developing tiles read as this one line to VoiceOver instead of 40 stops.
                <View
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={t("event.developingAll", { count: developingCount })}
                    style={styles.a11yLine}
                />
            ) : null}
        </View>
    );

    const extra = developingCount - MAX_DEVELOPING;
    const fadeNew = rightAway && shooting && !reduceMotion;
    const tileHeight = (tileWidth * 4) / 3;
    const targets: TileTarget[] = [
        { x: grid.side, y: headerHeight, width: tileWidth },
        { x: grid.side + tileWidth + grid.gap, y: headerHeight, width: tileWidth },
        { x: grid.side, y: headerHeight + tileHeight + grid.gap, width: tileWidth },
    ];

    return (
        <View style={styles.screen}>
            <View
                style={{ flex: 1 }}
                accessibilityElementsHidden={momentCandidate}
                importantForAccessibility={momentCandidate ? "no-hide-descendants" : "auto"}
            >
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
                            {(gallery.loading && gallery.cursor) ||
                            (roll && rollGallery.loading) ? (
                                <ActivityIndicator color={color.ash} />
                            ) : null}
                        </View>
                    }
                    onEndReached={() => {
                        loadMoreGallery(code, roll?.id).catch(() => null);
                    }}
                    onEndReachedThreshold={0.6}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => {
                                setRefreshing(true);
                                summary.reload();
                                people.reload();
                                refreshGallery(code, roll?.id)
                                    .catch(() => null)
                                    .finally(() => setRefreshing(false));
                            }}
                            tintColor={color.ash}
                        />
                    }
                    renderItem={({ item: row }) =>
                        row.kind === "photo" ? (
                            <PhotoTile
                                item={row.item}
                                host={host}
                                fade={fadeNew}
                                onPress={() =>
                                    router.push(
                                        `/e/${code}/${row.item.id}${roll ? `?guest=${roll.id}` : ""}` as Href,
                                    )
                                }
                            />
                        ) : (
                            <DevelopingTile index={row.index} name={row.name} />
                        )
                    }
                    showsVerticalScrollIndicator={false}
                />
            </View>
            {momentCandidate && first?.kind === "photos" ? (
                <MomentOver
                    code={code}
                    fallback={items}
                    page={first}
                    targets={targets}
                    onDone={() => {
                        storage.set(`moment:${code}`, true);
                        setMomentSeen(true);
                    }}
                />
            ) : null}
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
                removeFrom={host ? hostEvent?.id : undefined}
                onRemoved={() => {
                    people.reload();
                    summary.reload();
                }}
                onPick={(person) => {
                    showRoll(code, { id: person.id, name: person.name });
                    setShowPeople(false);
                }}
            />
        </View>
    );
}

/** The moment with the server's three highlights, or the first photos if they can't load. */
function MomentOver({
    code,
    fallback,
    page,
    targets,
    onDone,
}: {
    code: string;
    fallback: GalleryItem[];
    page: Extract<GalleryPage, { kind: "photos" }>;
    targets: readonly TileTarget[];
    onDone: () => void;
}) {
    const highlights = useLoad(`highlights:moment:${code}`, () =>
        api.guest.highlights(code, "moment"),
    );
    // The first photos stand in until the highlights arrive, so an early tap never opens empty.
    const cards = highlights.data?.items ?? fallback.slice(0, 3);
    return (
        <Moment
            items={cards}
            total={page.total}
            photographers={page.photographers}
            mine={page.mine}
            targets={targets}
            onDone={onDone}
        />
    );
}

function PhotoTile({
    item,
    host,
    fade,
    onPress,
}: {
    item: GalleryItem;
    host: boolean;
    fade: boolean;
    onPress: () => void;
}) {
    const width = useTileWidth();
    const badges = host
        ? [item.hidden ? "hidden" : null, item.reports > 0 ? "reported" : null]
        : [];
    const label = [
        t("event.photoBy", { name: item.photographer.name }),
        item.hidden && host ? t("event.hiddenBadge") : null,
        item.reports > 0 && host ? t("event.reportedBadge") : null,
    ]
        .filter(Boolean)
        .join(", ");
    return (
        <Animated.View {...(fade ? { entering: FadeIn.duration(400) } : {})} style={{ width }}>
            <Tile
                source={photoSource(item.thumbUrl, item.id, "thumb")}
                name={item.photographer.name}
                accessibilityLabel={label}
                onPress={onPress}
            />
            {badges.some(Boolean) ? (
                <View style={styles.badges} pointerEvents="none">
                    {item.hidden && host ? (
                        <View style={styles.badge}>
                            <Icon icon={icons.hide} size={15} color={color.paper} />
                        </View>
                    ) : null}
                    {item.reports > 0 && host ? (
                        <View style={styles.badge}>
                            <Icon icon={icons.report} size={14} color={color.paper} />
                            <Text variant="caption" style={{ fontSize: 12, lineHeight: 15 }}>
                                {formatCount(item.reports)}
                            </Text>
                        </View>
                    ) : null}
                </View>
            ) : null}
        </Animated.View>
    );
}

/**
 * A tile for a photo still developing, drawn from counts and names only: its tint comes from its
 * place in the grid and the photographer's first name, so neighbouring tiles differ.
 */
function DevelopingTile({ index, name }: { index: number; name: string | undefined }) {
    const width = useTileWidth();
    let seed = 0;
    for (const char of name ?? "") seed = (seed * 31 + char.charCodeAt(0)) % 360;
    const hue = (seed + index * 47) % 360;
    const light = 15 + ((index * 7 + seed) % 5) * 3;
    return (
        <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.devTile, { width, backgroundColor: `hsl(${hue}, 20%, ${light}%)` }]}
        >
            <Text serif italic style={styles.devText} maxScale={CHROME_SCALE}>
                {t("event.developing")}
            </Text>
            {name ? (
                <Text serif italic style={styles.devName} numberOfLines={1} maxScale={CHROME_SCALE}>
                    {name}
                </Text>
            ) : null}
        </View>
    );
}

function Gap() {
    return <View style={{ height: grid.gap }} />;
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    center: { flex: 1, justifyContent: "center", gap: 12 },
    back: { position: "absolute", left: 16 },
    night: { paddingHorizontal: gutter, paddingTop: space.m, paddingBottom: space.xs },
    actions: {
        flexDirection: "row",
        gap: 10,
        paddingTop: 8,
        paddingHorizontal: 12,
        paddingBottom: 10,
    },
    closed: {
        flex: 1,
        minHeight: 48,
        borderRadius: radius.control,
        backgroundColor: color.surface,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.m,
        paddingVertical: space.xs,
    },
    rollLine: { paddingHorizontal: gutter, marginBottom: space.xs },
    status: {
        height: STATUS_HEIGHT,
        justifyContent: "center",
        paddingHorizontal: gutter,
    },
    roll: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingHorizontal: gutter,
        paddingTop: 4,
        paddingBottom: 12,
    },
    empty: { paddingHorizontal: 40, paddingVertical: 28 },
    error: { paddingHorizontal: gutter, paddingBottom: space.l, alignItems: "center" },
    a11yLine: { height: 1, marginHorizontal: grid.side },
    columns: { justifyContent: "space-between", paddingHorizontal: grid.side },
    badges: { position: "absolute", top: 8, right: 8, flexDirection: "row", gap: 4 },
    badge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 7,
        height: 26,
        borderRadius: radius.round,
        backgroundColor: color.glass,
    },
    devTile: {
        aspectRatio: 3 / 4,
        borderRadius: radius.tile,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
    },
    devText: { fontSize: 20, lineHeight: 24, color: "rgba(255, 255, 255, 0.85)" },
    devName: {
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 9,
        fontSize: 19,
        lineHeight: 23,
        color: color.white,
        textShadowColor: "rgba(0, 0, 0, 0.7)",
        textShadowRadius: 10,
    },
});
