import {
    DEFAULT_SHOTS,
    MAX_SHOTS,
    MIN_SHOTS,
    OCCASIONS,
    TITLE_MAX,
    settingsProblems,
    type Event,
    type EventSettings,
    type EventSettingsPatch,
    type Occasion,
    type RevealMode,
    type Visibility,
} from "@linger/core/events";
import { DEFAULT_LOOK, LOOK_IDS, LOOKS, type LookId } from "@linger/core/film";
import { TIERS, UNLIMITED_SHOTS, due, type Due, type TierId } from "@linger/core/pricing";
import { revealTime, wallTime, zonedInstant } from "@linger/core/reveal";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, usePreventRemove, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    BackHandler,
    Keyboard,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import Animated, { FadeIn, Keyframe, SlideInLeft, SlideInRight } from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { z } from "zod";

import {
    devChrome,
    ApiError,
    api,
    asApiError,
    invalidate,
    storage,
    useLoad,
    useSession,
} from "@/api";
import { sendCover } from "@/cover";
import {
    deviceZone,
    formatDay,
    formatEnds,
    formatPrice,
    formatTime,
    occasionLabel,
    problem,
    revealModeLabel,
    revealWhen,
    t,
    uses24HourClock,
    visibilityLabel,
    zoneName,
} from "@/copy";
import { HostAppNote } from "@/home";
import { Invite } from "@/invite";
import { LookImage } from "@/look";
import {
    claimPending,
    PaymentsUnavailable,
    purchase,
    storePrices,
    testPurchases,
    type StorePrice,
} from "@/purchase";
import {
    Button,
    Field,
    Icon,
    Input,
    KeyValue,
    Label,
    Notice,
    OptionRow,
    Progress,
    Row,
    RowGroup,
    Screen,
    Segmented,
    Sheet,
    Slider,
    Text,
    TierRow,
    Toggle,
    color,
    confirm,
    haptic,
    icons,
    occasionIcons,
    radius,
    space,
    useReduceMotion,
} from "@/ui";

interface Cover {
    uri: string;
    mimeType: string;
    /** Already stored on the server, as for a resumed draft's cover. */
    remote?: boolean;
}

interface Draft {
    occasion: Occasion;
    title: string;
    startsAt: Date;
    endsAt: Date;
    timeZone: string;
    cover: Cover | null;
    revealMode: RevealMode;
    /** Only used when the reveal mode is custom. */
    revealAt: Date | null;
    /** MIN_SHOTS to MAX_SHOTS, or UNLIMITED. */
    shots: number;
    visibility: Visibility;
    look: LookId;
    tier: TierId;
    unlimited: boolean;
}

/** Fields an occasion suggests. Once the host sets one by hand, a new occasion leaves it alone. */
type Suggested = "endsAt" | "revealMode" | "shots" | "tier";

const UNLIMITED = MAX_SHOTS + 1;

const SHOT_STOPS = [
    { value: MIN_SHOTS, label: String(MIN_SHOTS) },
    { value: 15, label: "15" },
    { value: DEFAULT_SHOTS, label: String(DEFAULT_SHOTS) },
    { value: MAX_SHOTS, label: String(MAX_SHOTS) },
    { value: UNLIMITED, label: "∞" },
] as const;

const MODES: readonly RevealMode[] = ["right-away", "at-end", "next-morning"];

/** What each occasion suggests: when it ends (days after the start, at an hour), and the rules. */
const SUGGESTIONS: Record<
    Occasion,
    {
        endDays: number;
        endHour: number;
        revealMode: RevealMode;
        shots: number;
        tier: TierId;
    }
> = {
    wedding: { endDays: 1, endHour: 1, revealMode: "next-morning", shots: 24, tier: "tier-80" },
    birthday: { endDays: 1, endHour: 2, revealMode: "next-morning", shots: 24, tier: "tier-30" },
    trip: { endDays: 3, endHour: 18, revealMode: "at-end", shots: 36, tier: "free" },
    party: { endDays: 1, endHour: 1, revealMode: "next-morning", shots: 24, tier: "tier-30" },
    everyday: { endDays: 0, endHour: 21, revealMode: "at-end", shots: 15, tier: "free" },
};

/** The sample photo each occasion previews the looks on until a cover is chosen. */
const SAMPLES: Record<Occasion, number> = {
    wedding: require("../assets/demo/w-dog.jpg"),
    birthday: require("../assets/demo/b-cake.jpg"),
    trip: require("../assets/demo/t-drive.jpg"),
    party: require("../assets/demo/p-cheer.jpg"),
    everyday: require("../assets/demo/e-couple.jpg"),
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Start hour on a day other than today. */
const EVENING_HOUR = 18;
/** Dates this far off get the time zone row, since the host may be planning a trip. */
const FAR_OFF_MS = 3 * DAY;
const NAME_HINT_FROM = 50;

// Times are kept as instants and read as wall-clock times in the event's zone, which can differ
// from the device's when a host plans a trip.

function sameDay(a: Date, b: Date, zone: string): boolean {
    const x = wallTime(a, zone);
    const y = wallTime(b, zone);
    return x.year === y.year && x.month === y.month && x.day === y.day;
}

/** The next :00 or :30 after now, in the zone. */
function nextHalfHour(now: Date, zone: string): Date {
    const w = wallTime(now, zone);
    return zonedInstant(w.year, w.month, w.day, w.hour, w.minute < 30 ? 30 : 60, zone);
}

/** Where the start goes when the host picks a day: the next half hour today, 18:00 otherwise. */
function startOn(day: Date, zone: string, now: Date): Date {
    if (sameDay(day, now, zone)) return nextHalfHour(now, zone);
    const w = wallTime(day, zone);
    return zonedInstant(w.year, w.month, w.day, EVENING_HOUR, 0, zone);
}

function suggestedEnd(occasion: Occasion, startsAt: Date, zone: string, now: Date): Date {
    const s = SUGGESTIONS[occasion];
    const w = wallTime(startsAt, zone);
    const end = zonedInstant(w.year, w.month, w.day + s.endDays, s.endHour, 0, zone);
    const from = Math.max(startsAt.getTime(), now.getTime());
    if (end.getTime() > from + HOUR) return end;
    // The suggested hour has passed: give the event the rest of the evening.
    const later = wallTime(new Date(from + 3 * HOUR), zone);
    return zonedInstant(later.year, later.month, later.day, later.hour, 0, zone);
}

/** A device-local Date showing the event's wall-clock time, for the system pickers. */
function toPicker(at: Date, zone: string): Date {
    const w = wallTime(at, zone);
    return new Date(w.year, w.month - 1, w.day, w.hour, w.minute);
}

/** The instant a picker's wall-clock time means in the event's zone. */
function fromPicker(local: Date, zone: string): Date {
    return zonedInstant(
        local.getFullYear(),
        local.getMonth() + 1,
        local.getDate(),
        local.getHours(),
        local.getMinutes(),
        zone,
    );
}

function newDraft(occasion: Occasion): Draft {
    const now = new Date();
    const zone = deviceZone();
    const startsAt = nextHalfHour(now, zone);
    const s = SUGGESTIONS[occasion];
    return {
        occasion,
        title: "",
        startsAt,
        endsAt: suggestedEnd(occasion, startsAt, zone, now),
        timeZone: zone,
        cover: null,
        revealMode: s.revealMode,
        revealAt: null,
        shots: s.shots,
        visibility: "everyone",
        look: DEFAULT_LOOK,
        tier: s.tier,
        unlimited: false,
    };
}

function fromEvent(event: Event): Draft {
    const s = event.settings;
    return {
        occasion: s.occasion,
        title: s.title,
        startsAt: new Date(s.startsAt),
        endsAt: new Date(s.endsAt),
        timeZone: s.timeZone,
        cover: event.coverUrl
            ? { uri: event.coverUrl, mimeType: "image/jpeg", remote: true }
            : null,
        revealMode: s.revealMode,
        revealAt: s.revealAt ? new Date(s.revealAt) : null,
        shots: s.shotsPerGuest ?? UNLIMITED,
        visibility: s.visibility,
        look: s.look,
        tier: event.tier,
        unlimited: event.unlimitedShots,
    };
}

function settingsOf(draft: Draft): EventSettings {
    const custom = draft.revealMode === "custom" && draft.revealAt !== null;
    return {
        occasion: draft.occasion,
        title: draft.title.trim(),
        startsAt: draft.startsAt.toISOString(),
        endsAt: draft.endsAt.toISOString(),
        timeZone: draft.timeZone,
        revealMode: draft.revealMode === "custom" && !custom ? "at-end" : draft.revealMode,
        ...(custom && draft.revealAt ? { revealAt: draft.revealAt.toISOString() } : {}),
        // Unlimited needs the add-on. The purchase switches the event to unlimited once it's paid.
        shotsPerGuest: Math.min(draft.shots, MAX_SHOTS),
        visibility: draft.visibility,
        look: draft.look,
    };
}

/** The settings that differ from what the server has, for saving edits made after creating. */
function changesFrom(event: Event, draft: Draft): EventSettingsPatch {
    const wanted = settingsOf(draft);
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(wanted) as (keyof EventSettings)[]) {
        // Once the add-on is bought the server holds unlimited as null; the draft's 36 isn't a change.
        if (key === "shotsPerGuest" && event.unlimitedShots && draft.shots === UNLIMITED) continue;
        if (wanted[key] !== event.settings[key]) patch[key] = wanted[key];
    }
    return patch as EventSettingsPatch;
}

/** When the draft's photos would appear. Once the event exists, the server's revealsAt is used. */
function whenPhrase(draft: Draft): string {
    return revealWhen(new Date(), revealTime(settingsOf(draft)));
}

function problemsAt(draft: Draft, path: "endsAt" | "revealAt"): boolean {
    if (path === "revealAt" && draft.revealMode === "custom" && draft.revealAt === null) {
        return true;
    }
    return settingsProblems(settingsOf(draft)).some((p) => p.path === path);
}

/** A draft kept on the device when the session ends mid-way, so signing in again resumes it. */
const stashKey = (hostId: string) => `createDraft:${hostId}`;

const Stash = z.object({
    occasion: z.enum(OCCASIONS),
    title: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
    timeZone: z.string(),
    cover: z.object({ uri: z.string(), mimeType: z.string() }).nullable(),
    revealMode: z.enum(["right-away", "at-end", "next-morning", "custom"]),
    revealAt: z.string().nullable(),
    shots: z.number(),
    visibility: z.enum(["everyone", "host-only"]),
    look: z.enum(LOOK_IDS),
    tier: z.enum(["free", "tier-30", "tier-80", "tier-150", "tier-250"]),
    unlimited: z.boolean(),
});

function stash(hostId: string, draft: Draft): void {
    const cover = draft.cover && !draft.cover.remote ? draft.cover : null;
    storage.set(
        stashKey(hostId),
        JSON.stringify({
            ...draft,
            cover: cover ? { uri: cover.uri, mimeType: cover.mimeType } : null,
            startsAt: draft.startsAt.toISOString(),
            endsAt: draft.endsAt.toISOString(),
            revealAt: draft.revealAt?.toISOString() ?? null,
        }),
    );
}

function unstash(hostId: string | undefined): Draft | null {
    if (!hostId) return null;
    try {
        const raw = storage.getString(stashKey(hostId));
        storage.remove(stashKey(hostId));
        const parsed = raw ? Stash.safeParse(JSON.parse(raw)) : null;
        if (!parsed?.success) return null;
        const d = parsed.data;
        return {
            ...d,
            startsAt: new Date(d.startsAt),
            endsAt: new Date(d.endsAt),
            revealAt: d.revealAt ? new Date(d.revealAt) : null,
        };
    } catch {
        return null;
    }
}

/** Compared to tell whether anything changed since the flow opened. */
const fingerprint = (draft: Draft) => JSON.stringify(draft);

export function CreateScreen() {
    if (Platform.OS === "web") return <HostAppNote />;
    return <Create />;
}

const INVITE_IN = new Keyframe({
    0: { opacity: 0, transform: [{ scale: 0.96 }] },
    100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(260);

type CoverState = "idle" | "uploading" | "done" | "failed";

function Create() {
    const router = useRouter();
    const session = useSession();
    const still = useReduceMotion();
    const params = useLocalSearchParams<{ event?: string }>();
    const resumeId = typeof params.event === "string" ? params.event : null;
    const resume = useLoad(resumeId ? `draft:${resumeId}` : null, () =>
        api.events.get(resumeId ?? ""),
    );

    const [step, setStep] = useState(1);
    const [direction, setDirection] = useState(1);
    const [draft, setDraft] = useState<Draft>(() =>
        resumeId ? newDraft("wedding") : (unstash(session?.host.id) ?? newDraft("wedding")),
    );
    const [baseline, setBaseline] = useState(() => fingerprint(draft));
    const [touched, setTouched] = useState<ReadonlySet<Suggested>>(new Set());
    const [event, setEvent] = useState<Event | null>(null);
    const [resumed, setResumed] = useState<string | null>(null);
    const [coverState, setCoverState] = useState<CoverState>("idle");
    const [exit, setExit] = useState<"back" | "home" | null>(null);
    const [prices, setPrices] = useState<Record<string, StorePrice>>({});
    const creating = useRef<Promise<Event> | null>(null);
    const coverJob = useRef<Promise<void> | null>(null);
    const latestCover = useRef<string | null>(null);
    const createdHere = useRef(false);

    // A draft opened from the events list continues at the price step, with Back to every step.
    if (resume.data && resumed !== resume.data.id) {
        const restored = fromEvent(resume.data);
        setResumed(resume.data.id);
        setDraft(restored);
        setBaseline(fingerprint(restored));
        setEvent(resume.data);
        setCoverState(restored.cover ? "done" : "idle");
        setStep(5);
    }

    const hostId = session?.host.id;
    useEffect(() => {
        if (!hostId) return;
        const ids = [
            ...TIERS.flatMap((tier) => (tier.productId ? [tier.productId] : [])),
            UNLIMITED_SHOTS.productId,
        ];
        storePrices(hostId, ids)
            .then(setPrices)
            .catch(() => null);
    }, [hostId]);

    // A session the server ended keeps what was entered and goes to Welcome, which says why.
    // Leaving on purpose (signed out, a deleted draft) skips the discard question.
    const leaving = exit ?? (session === null ? "home" : null);
    const latestDraft = useRef(draft);
    const lastHost = useRef(session?.host.id);
    useEffect(() => {
        latestDraft.current = draft;
        if (session) lastHost.current = session.host.id;
    });
    useEffect(() => {
        if (leaving === null) return;
        if (session === null && lastHost.current) stash(lastHost.current, latestDraft.current);
        if (leaving === "home") router.replace("/");
        else if (router.canGoBack()) router.back();
        else router.replace("/");
    }, [leaving, session, router]);

    const dirty = step !== 6 && fingerprint(draft) !== baseline;

    usePreventRemove(dirty && leaving === null, ({ repeat }) => {
        haptic("warning");
        Alert.alert(
            t("create.discardTitle"),
            resumeId ? t("create.discardBodyResumed") : t("create.discardBody"),
            [
                { text: t("create.keepEditing"), style: "cancel" },
                {
                    text: t("create.discard"),
                    style: "destructive",
                    onPress: () => {
                        if (createdHere.current && event) {
                            api.events
                                .delete(event.id, event.code)
                                .then(() => invalidate("events:"))
                                .catch(() => null);
                        }
                        repeat();
                    },
                },
            ],
        );
    });

    const update = (patch: Partial<Draft>) => {
        setDraft((d) => ({ ...d, ...patch }));
        // Moving the start carries the end along; that isn't the host choosing an end.
        const set = (Object.keys(patch) as (keyof Draft)[]).filter(
            (k): k is Suggested =>
                (k === "endsAt" && !("startsAt" in patch)) ||
                k === "revealMode" ||
                k === "shots" ||
                k === "tier",
        );
        if (set.length > 0) setTouched((prev) => new Set([...prev, ...set]));
    };

    const chooseOccasion = (occasion: Occasion) => {
        if (occasion === draft.occasion) return;
        haptic("selection");
        const s = SUGGESTIONS[occasion];
        setDraft((d) => ({
            ...d,
            occasion,
            endsAt: touched.has("endsAt")
                ? d.endsAt
                : suggestedEnd(occasion, d.startsAt, d.timeZone, new Date()),
            revealMode: touched.has("revealMode") ? d.revealMode : s.revealMode,
            shots: touched.has("shots") ? d.shots : s.shots,
            tier: touched.has("tier") ? d.tier : s.tier,
        }));
    };

    const go = (next: number) => {
        setDirection(next > step ? 1 : -1);
        setStep(next);
    };

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
    };

    const back = () => {
        if (step === 1 || step === 6) leave();
        else go(step - 1);
    };

    const onBack = useRef(back);
    useEffect(() => {
        onBack.current = back;
    });
    useEffect(() => {
        const sub = BackHandler.addEventListener("hardwareBackPress", () => {
            onBack.current();
            return true;
        });
        return () => sub.remove();
    }, []);

    /** The server's draft, created once from what has been entered so far. */
    const ensureEvent = (): Promise<Event> => {
        if (event) return Promise.resolve(event);
        creating.current ??= api.events.create(settingsOf(draft)).then(
            (created) => {
                createdHere.current = true;
                setEvent(created);
                invalidate("events:");
                return created;
            },
            (error: unknown) => {
                creating.current = null;
                throw error;
            },
        );
        return creating.current;
    };

    const uploadCover = (cover: Cover, eventId: string) => {
        if (cover.remote) return;
        latestCover.current = cover.uri;
        setCoverState("uploading");
        coverJob.current = sendCover(eventId, cover.uri).then(
            () => {
                if (latestCover.current === cover.uri) setCoverState("done");
                invalidate("events:");
            },
            () => {
                if (latestCover.current === cover.uri) setCoverState("failed");
            },
        );
    };

    const canCreate = (d: Draft) => d.title.trim() !== "" && !problemsAt(d, "endsAt");

    /** Starts the cover upload as soon as there is an event to attach it to. */
    const coverChosen = (cover: Cover | null) => {
        update({ cover });
        latestCover.current = cover?.uri ?? null;
        setCoverState("idle");
        if (!cover) {
            if (event) {
                const id = event.id;
                coverJob.current = (coverJob.current ?? Promise.resolve())
                    .then(() => api.events.removeCover(id))
                    .then(
                        () => invalidate("events:"),
                        () => undefined,
                    );
            }
            return;
        }
        if (event) uploadCover(cover, event.id);
        else if (canCreate(draft)) {
            ensureEvent()
                .then((e) => uploadCover(cover, e.id))
                .catch(() => null);
        }
    };

    const next = () => {
        if (step === 2 && canCreate(draft)) {
            const cover = draft.cover;
            ensureEvent()
                .then((e) => {
                    if (cover && coverState === "idle") uploadCover(cover, e.id);
                })
                .catch(() => null);
        }
        go(step + 1);
    };

    const removeDraft = () => {
        if (!event) return;
        confirm(
            t("create.deleteDraftTitle"),
            t("create.deleteDraftBody"),
            t("create.deleteDraft"),
            () => {
                api.events
                    .delete(event.id, event.code)
                    .then(() => {
                        invalidate("events:");
                        setExit("back");
                    })
                    .catch(() => null);
            },
        );
    };

    if (step === 6 && event) {
        return (
            <Animated.View
                style={{ flex: 1, backgroundColor: color.night }}
                entering={still ? FadeIn.duration(220) : INVITE_IN}
            >
                <Invite event={event} onDone={leave} />
            </Animated.View>
        );
    }

    const entering = still
        ? FadeIn.duration(220)
        : (direction > 0 ? SlideInRight : SlideInLeft).duration(220);

    return (
        <Screen
            scroll
            footer={
                <Footer
                    step={step}
                    draft={draft}
                    event={event}
                    prices={prices}
                    coverState={coverState}
                    ensureEvent={ensureEvent}
                    uploadCover={uploadCover}
                    coverJob={coverJob}
                    onNext={next}
                    onStarted={(started) => {
                        haptic("success");
                        invalidate("events:");
                        setEvent(started);
                        setStep(6);
                    }}
                    onEvent={setEvent}
                    onEndPassed={() => go(2)}
                    onAttempted={() => {
                        // From here the draft is the host's to keep, so leaving doesn't ask.
                        createdHere.current = false;
                        setBaseline(fingerprint(draft));
                    }}
                />
            }
        >
            <View style={styles.top}>
                <Pressable
                    onPress={back}
                    accessibilityRole="button"
                    accessibilityLabel={step === 1 ? t("create.close") : t("common.back")}
                    hitSlop={12}
                    style={styles.back}
                >
                    <Icon icon={step === 1 ? icons.close : icons.back} size={22} />
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Progress step={step} />
                </View>
            </View>
            <Animated.View key={step} entering={entering}>
                {step === 1 ? (
                    <OccasionStep value={draft.occasion} onChange={chooseOccasion} />
                ) : step === 2 ? (
                    <NameStep
                        draft={draft}
                        onChange={update}
                        coverState={coverState}
                        onCover={coverChosen}
                    />
                ) : step === 3 ? (
                    <RulesStep draft={draft} onChange={update} event={event} prices={prices} />
                ) : step === 4 ? (
                    <LookStep draft={draft} onChange={update} />
                ) : (
                    <GuestsStep
                        draft={draft}
                        onChange={update}
                        event={event}
                        prices={prices}
                        onDelete={event && event.state === "draft" ? removeDraft : null}
                    />
                )}
            </Animated.View>
        </Screen>
    );
}

// Steps

function OccasionStep({ value, onChange }: { value: Occasion; onChange: (o: Occasion) => void }) {
    return (
        <>
            <Text variant="display" accessibilityRole="header">
                {t("create.occasion.title")}
            </Text>
            <Text variant="small" tone="ash" style={{ marginTop: 12, marginBottom: 24 }}>
                {t("create.occasion.body")}
            </Text>
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
                {OCCASIONS.map((occasion) => (
                    <OptionRow
                        key={occasion}
                        icon={occasionIcons[occasion]}
                        label={occasionLabel(occasion)}
                        selected={occasion === value}
                        onPress={() => onChange(occasion)}
                    />
                ))}
            </View>
        </>
    );
}

interface StepProps {
    draft: Draft;
    onChange: (patch: Partial<Draft>) => void;
}

type Picking = "day" | "start" | "end" | "reveal" | null;

/** The system date and time pickers: a sheet on iOS, dialogs on Android. */
function usePicker(zone: string) {
    const [picking, setPicking] = useState<Picking>(null);

    const open = (
        which: Exclude<Picking, null>,
        value: Date,
        minimum: Date | undefined,
        onPick: (at: Date) => void,
    ) => {
        Keyboard.dismiss();
        if (Platform.OS !== "android") {
            setPicking(which);
            return;
        }
        const common = {
            ...(minimum ? { minimumDate: toPicker(minimum, zone) } : {}),
            is24Hour: uses24HourClock(),
        };
        const local = toPicker(value, zone);
        if (which === "start") {
            DateTimePickerAndroid.open({
                ...common,
                value: local,
                mode: "time",
                minuteInterval: 5,
                onValueChange: (_, time) => onPick(fromPicker(time, zone)),
            });
            return;
        }
        DateTimePickerAndroid.open({
            ...common,
            value: local,
            mode: "date",
            onValueChange: (_, day) => {
                if (which === "day") {
                    onPick(fromPicker(day, zone));
                    return;
                }
                DateTimePickerAndroid.open({
                    value: local,
                    mode: "time",
                    is24Hour: uses24HourClock(),
                    onValueChange: (__, time) => {
                        const at = new Date(day);
                        at.setHours(time.getHours(), time.getMinutes(), 0, 0);
                        onPick(fromPicker(at, zone));
                    },
                });
            },
        });
    };

    return { picking, open, close: () => setPicking(null) };
}

interface NameStepProps extends StepProps {
    coverState: CoverState;
    onCover: (cover: Cover | null) => void;
}

function NameStep({ draft, onChange, coverState, onCover }: NameStepProps) {
    const zone = draft.timeZone;
    const picker = usePicker(zone);
    const [choosingZone, setChoosingZone] = useState(false);
    const [zoneAsked, setZoneAsked] = useState(false);
    const now = new Date();

    const pickCover = async () => {
        Keyboard.dismiss();
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.85,
        });
        const asset = result.canceled ? undefined : result.assets[0];
        if (asset) onCover({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" });
    };

    // Moving the start keeps the event's length.
    const moveStart = (startsAt: Date) => {
        const length = draft.endsAt.getTime() - draft.startsAt.getTime();
        onChange({ startsAt, endsAt: new Date(startsAt.getTime() + Math.max(length, HOUR)) });
    };

    const setDay = (day: Date) => moveStart(startOn(day, zone, new Date()));

    const setStartTime = (at: Date) => {
        const day = wallTime(draft.startsAt, zone);
        const time = wallTime(at, zone);
        moveStart(zonedInstant(day.year, day.month, day.day, time.hour, time.minute, zone));
    };

    // A new zone keeps the wall-clock times: Saturday 18:00 stays 18:00 where the event is.
    const setZone = (next: string) => {
        const move = (at: Date) => {
            const w = wallTime(at, zone);
            return zonedInstant(w.year, w.month, w.day, w.hour, w.minute, next);
        };
        onChange({
            timeZone: next,
            startsAt: move(draft.startsAt),
            endsAt: move(draft.endsAt),
            ...(draft.revealAt ? { revealAt: move(draft.revealAt) } : {}),
        });
        setChoosingZone(false);
    };

    const endsBeforeStart = problemsAt(draft, "endsAt");
    const left = TITLE_MAX - draft.title.length;
    const showZone =
        zoneAsked ||
        draft.occasion === "trip" ||
        draft.timeZone !== deviceZone() ||
        draft.startsAt.getTime() - now.getTime() > FAR_OFF_MS;
    const minimumEnd = new Date(draft.startsAt.getTime() + 15 * MINUTE);

    return (
        <>
            <Text variant="title" accessibilityRole="header">
                {t("create.name.title")}
            </Text>
            <Field
                value={draft.title}
                onChangeText={(title) => onChange({ title })}
                placeholder={t(`create.name.placeholder.${draft.occasion}`)}
                maxLength={TITLE_MAX}
                autoFocus={draft.title === ""}
                autoCapitalize="words"
                returnKeyType="done"
                multiline
                submitBehavior="blurAndSubmit"
                style={{ marginTop: 20 }}
                accessibilityLabel={t("create.name.title")}
            />
            {draft.title.length >= NAME_HINT_FROM ? (
                <Text variant="caption" tone="ash" align="right">
                    {t("create.name.left", { count: left })}
                </Text>
            ) : null}
            <View style={{ marginTop: 6 }}>
                <KeyValue
                    label={t("create.name.date")}
                    value={formatDay(draft.startsAt, zone)}
                    onPress={() => picker.open("day", draft.startsAt, now, setDay)}
                />
                <KeyValue
                    label={t("create.name.starts")}
                    value={formatTime(draft.startsAt, zone)}
                    onPress={() => picker.open("start", draft.startsAt, undefined, setStartTime)}
                />
                <KeyValue
                    label={t("create.name.ends")}
                    value={formatEnds(draft.startsAt, draft.endsAt, zone)}
                    onPress={() =>
                        picker.open("end", draft.endsAt, minimumEnd, (endsAt) =>
                            onChange({ endsAt }),
                        )
                    }
                />
                {showZone ? (
                    <KeyValue
                        label={t("create.name.timeZone")}
                        value={zoneName(zone)}
                        onPress={() => {
                            Keyboard.dismiss();
                            setChoosingZone(true);
                        }}
                    />
                ) : null}
            </View>
            {!showZone ? (
                <Pressable
                    onPress={() => setZoneAsked(true)}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={{ alignSelf: "flex-start", marginTop: space.s }}
                >
                    <Text variant="small" tone="ash" weight="medium">
                        {t("create.name.zoneChange")}
                    </Text>
                </Pressable>
            ) : null}
            {endsBeforeStart ? <Notice>{t("create.name.endsBefore")}</Notice> : null}
            <Label>{t("create.name.cover")}</Label>
            <Pressable
                onPress={() => {
                    pickCover().catch(() => null);
                }}
                accessibilityRole="button"
                accessibilityLabel={
                    draft.cover ? t("create.name.coverChange") : t("create.name.coverChoose")
                }
                accessibilityState={{ busy: coverState === "uploading" }}
                style={styles.cover}
            >
                {draft.cover ? (
                    <Image
                        source={draft.cover.uri}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                    />
                ) : (
                    <View style={styles.coverEmpty}>
                        <Icon icon={icons.image} size={28} weight="duotone" color={color.ash} />
                        <Text variant="small" tone="ash">
                            {t("create.name.coverChoose")}
                        </Text>
                    </View>
                )}
                {coverState === "uploading" ? (
                    <View style={styles.coverBusy}>
                        <ActivityIndicator color={color.paper} />
                    </View>
                ) : null}
            </Pressable>
            {draft.cover ? (
                <Pressable
                    onPress={() => onCover(null)}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={{ alignSelf: "flex-start", marginTop: space.m }}
                >
                    <Text variant="small" tone="ash" weight="medium">
                        {t("create.name.coverRemove")}
                    </Text>
                </Pressable>
            ) : null}
            {coverState === "failed" ? <Notice>{t("create.name.coverFailed")}</Notice> : null}

            <DateSheet
                visible={picker.picking !== null && picker.picking !== "reveal"}
                mode={
                    picker.picking === "day"
                        ? "date"
                        : picker.picking === "start"
                          ? "time"
                          : "datetime"
                }
                value={toPicker(picker.picking === "end" ? draft.endsAt : draft.startsAt, zone)}
                {...(picker.picking === "day"
                    ? { minimumDate: toPicker(now, zone) }
                    : picker.picking === "end"
                      ? { minimumDate: toPicker(minimumEnd, zone) }
                      : {})}
                onChange={(local) => {
                    const at = fromPicker(local, zone);
                    if (picker.picking === "day") setDay(at);
                    else if (picker.picking === "start") setStartTime(at);
                    else onChange({ endsAt: at });
                }}
                onClose={picker.close}
            />
            <ZoneSheet
                visible={choosingZone}
                value={zone}
                onChange={setZone}
                onClose={() => setChoosingZone(false)}
            />
        </>
    );
}

interface DateSheetProps {
    visible: boolean;
    mode: "date" | "time" | "datetime";
    value: Date;
    minimumDate?: Date;
    onChange: (date: Date) => void;
    onClose: () => void;
}

/** The iOS date picker in a sheet. Android uses the system dialogs instead. */
function DateSheet({ visible, mode, value, minimumDate, onChange, onClose }: DateSheetProps) {
    return (
        <Sheet visible={visible} onClose={onClose}>
            <View style={{ alignItems: "center" }}>
                <DateTimePicker
                    value={value}
                    mode={mode}
                    display={mode === "date" ? "inline" : "spinner"}
                    {...(minimumDate ? { minimumDate } : {})}
                    themeVariant="dark"
                    accentColor={color.candle}
                    textColor={color.paper}
                    minuteInterval={5}
                    onValueChange={(_, date) => onChange(date)}
                />
            </View>
            <Button label={t("common.done")} onPress={onClose} />
        </Sheet>
    );
}

/** Common zones, for engines without `Intl.supportedValuesOf`. */
const COMMON_ZONES = [
    "America/Vancouver",
    "America/Los_Angeles",
    "America/Edmonton",
    "America/Denver",
    "America/Phoenix",
    "America/Winnipeg",
    "America/Chicago",
    "America/Toronto",
    "America/New_York",
    "America/Halifax",
    "America/St_Johns",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Mexico_City",
    "America/Sao_Paulo",
    "Europe/London",
    "Europe/Dublin",
    "Europe/Lisbon",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Madrid",
    "Europe/Rome",
    "Europe/Athens",
    "Europe/Istanbul",
    "Asia/Dubai",
    "Asia/Baku",
    "Asia/Kolkata",
    "Asia/Bangkok",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Asia/Seoul",
    "Australia/Perth",
    "Australia/Sydney",
    "Pacific/Auckland",
];

function allZones(): readonly string[] {
    try {
        const zones = Intl.supportedValuesOf("timeZone");
        return zones.length > 0 ? zones : COMMON_ZONES;
    } catch {
        return COMMON_ZONES;
    }
}

const ZONE_ROWS = 40;

function ZoneSheet({
    visible,
    value,
    onChange,
    onClose,
}: {
    visible: boolean;
    value: string;
    onChange: (zone: string) => void;
    onClose: () => void;
}) {
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase().replace(/\s+/g, "_");
    const zones = allZones()
        .filter((zone) => q === "" || zone.toLowerCase().includes(q))
        .slice(0, ZONE_ROWS);
    return (
        <Sheet visible={visible} onClose={onClose}>
            <Text variant="heading" align="center" accessibilityRole="header">
                {t("create.name.timeZone")}
            </Text>
            <Input
                value={query}
                onChangeText={setQuery}
                placeholder={t("create.name.zoneSearch")}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel={t("create.name.zoneSearch")}
            />
            <View style={styles.zoneList}>
                <ScrollView keyboardShouldPersistTaps="handled">
                    <RowGroup>
                        {zones.map((zone) => (
                            <Row
                                key={zone}
                                label={zoneName(zone)}
                                note={zone}
                                {...(zone === value ? { icon: icons.check } : {})}
                                onPress={() => onChange(zone)}
                            />
                        ))}
                    </RowGroup>
                </ScrollView>
            </View>
        </Sheet>
    );
}

interface PricedProps {
    event: Event | null;
    prices: Record<string, StorePrice>;
}

function RulesStep({ draft, onChange, event, prices }: StepProps & PricedProps) {
    const zone = draft.timeZone;
    const picker = usePicker(zone);
    const unlimited = draft.shots === UNLIMITED;
    const custom = draft.revealMode === "custom";
    const revealValue =
        draft.revealAt ?? revealTime({ ...settingsOf(draft), revealMode: "at-end" });

    // On iOS the sheet shows a time at once, so the reveal is custom from the moment it opens.
    const pickReveal = () => {
        if (Platform.OS !== "android") onChange({ revealMode: "custom", revealAt: revealValue });
        picker.open("reveal", revealValue, draft.endsAt, (revealAt) =>
            onChange({ revealMode: "custom", revealAt }),
        );
    };

    return (
        <>
            <Text variant="title" accessibilityRole="header">
                {t("create.rules.title")}
            </Text>
            <Label>{t("create.rules.when")}</Label>
            <Segmented<RevealMode>
                options={MODES.map((m) => ({ value: m, label: revealModeLabel(m) }))}
                value={draft.revealMode}
                onChange={(revealMode) => onChange({ revealMode })}
                accessibilityLabel={t("create.rules.when")}
            />
            <Pressable
                onPress={pickReveal}
                accessibilityRole="button"
                accessibilityState={{ selected: custom }}
                hitSlop={8}
                style={{ alignSelf: "flex-start", marginTop: space.m }}
            >
                <Text variant="small" tone={custom ? "paper" : "ash"} weight="medium">
                    {t("create.rules.pickTime")}
                </Text>
            </Pressable>
            <Text variant="small" tone="ash" style={{ marginTop: 10 }}>
                {draft.revealMode === "right-away"
                    ? t("create.rules.rightAwayNote")
                    : t("create.rules.whenNote", { when: whenPhrase(draft) })}
            </Text>
            {problemsAt(draft, "revealAt") ? (
                <Notice>{t("create.rules.revealBefore")}</Notice>
            ) : null}
            <Label
                right={
                    <Text serif italic style={styles.shots}>
                        {unlimited ? "∞" : String(draft.shots)}
                    </Text>
                }
            >
                {t("create.rules.shots")}
            </Label>
            <Slider
                stops={SHOT_STOPS}
                value={draft.shots}
                onChange={(shots) =>
                    onChange({ shots, unlimited: shots === UNLIMITED ? true : draft.unlimited })
                }
                accessibilityLabel={t("create.rules.shots")}
                describe={(v) => (v === UNLIMITED ? t("create.guests.unlimited") : String(v))}
            />
            {unlimited && !event?.unlimitedShots ? (
                <Text variant="small" tone="ash" style={{ marginTop: space.m }}>
                    {t("create.rules.unlimitedPrice", {
                        price: priceOf(
                            UNLIMITED_SHOTS.productId,
                            UNLIMITED_SHOTS.priceCents,
                            prices,
                        ),
                    })}
                </Text>
            ) : null}
            <Label>{t("create.rules.who")}</Label>
            <Segmented
                options={(["everyone", "host-only"] as const).map((v) => ({
                    value: v,
                    label: visibilityLabel(v),
                }))}
                value={draft.visibility}
                onChange={(visibility) => onChange({ visibility })}
                accessibilityLabel={t("create.rules.who")}
            />
            {draft.visibility === "host-only" ? (
                <Text variant="small" tone="ash" style={{ marginTop: 10 }}>
                    {t("create.rules.hostOnlyNote")}
                </Text>
            ) : null}
            <DateSheet
                visible={picker.picking === "reveal"}
                mode="datetime"
                value={toPicker(revealValue, zone)}
                minimumDate={toPicker(draft.endsAt, zone)}
                onChange={(local) =>
                    onChange({ revealMode: "custom", revealAt: fromPicker(local, zone) })
                }
                onClose={picker.close}
            />
        </>
    );
}

function LookStep({ draft, onChange }: StepProps) {
    const source = draft.cover?.uri ?? SAMPLES[draft.occasion];
    return (
        <>
            <Text variant="title" accessibilityRole="header">
                {t("create.look.title")}
            </Text>
            <Text variant="small" tone="ash" style={{ marginTop: 8, marginBottom: 20 }}>
                {t("create.look.body")}
            </Text>
            <View style={{ gap: 12 }} accessibilityRole="radiogroup">
                {LOOK_IDS.map((id) => {
                    const on = id === draft.look;
                    return (
                        <Pressable
                            key={id}
                            onPress={() => {
                                if (on) return;
                                haptic("selection");
                                onChange({ look: id });
                            }}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={`${LOOKS[id].name}, ${LOOKS[id].description}`}
                            style={[styles.look, on ? { borderColor: color.white } : null]}
                        >
                            <LookImage source={source} look={id} style={StyleSheet.absoluteFill} />
                            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                                <Defs>
                                    <LinearGradient id={`look-${id}`} x1="0" y1="0" x2="1" y2="0">
                                        <Stop offset={0} stopColor="#000" stopOpacity={0.55} />
                                        <Stop offset={0.6} stopColor="#000" stopOpacity={0} />
                                    </LinearGradient>
                                </Defs>
                                <Rect width="100%" height="100%" fill={`url(#look-${id})`} />
                            </Svg>
                            <View style={styles.lookText}>
                                <Text serif italic style={styles.lookName}>
                                    {LOOKS[id].name}
                                </Text>
                                <Text variant="caption" style={styles.lookDescription}>
                                    {LOOKS[id].description}
                                </Text>
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        </>
    );
}

/** The store's price for a product when it has one (in the host's currency), else core's. */
function priceOf(productId: string | null, cents: number, prices: Record<string, StorePrice>) {
    if (cents === 0 || !productId) return formatPrice(cents);
    return prices[productId]?.priceString ?? formatPrice(cents);
}

/** What is still due, in the store's currency when it priced every product. */
function totalOf(owed: Due, prices: Record<string, StorePrice>): string {
    const ids = [owed.tier?.productId, owed.addOn?.productId].filter(
        (id): id is string => typeof id === "string",
    );
    const store = ids.map((id) => prices[id]);
    const first = store[0];
    if (ids.length === 0 || !first || store.some((p) => p?.currencyCode !== first.currencyCode)) {
        return formatPrice(owed.cents);
    }
    if (store.length === 1) return first.priceString;
    const sum = store.reduce((total, p) => total + (p?.price ?? 0), 0);
    try {
        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: first.currencyCode,
        }).format(sum);
    } catch {
        return formatPrice(owed.cents);
    }
}

interface GuestsStepProps extends StepProps, PricedProps {
    /** Deletes the server's draft; null when there is none to delete. */
    onDelete: (() => void) | null;
}

function GuestsStep({ draft, onChange, event, prices, onDelete }: GuestsStepProps) {
    const included = event?.unlimitedShots ?? false;
    return (
        <>
            <Text variant="title" accessibilityRole="header">
                {t("create.guests.title")}
            </Text>
            <Text variant="small" tone="ash" style={{ marginTop: 8, marginBottom: 20 }}>
                {t("create.guests.body")}
            </Text>
            <View style={{ gap: 10 }} accessibilityRole="radiogroup">
                {TIERS.map((tier) => (
                    <TierRow
                        key={tier.id}
                        label={t("create.guests.tier", { count: tier.guests })}
                        price={priceOf(tier.productId, tier.priceCents, prices)}
                        selected={tier.id === draft.tier}
                        onPress={() => {
                            if (tier.id === draft.tier) return;
                            haptic("selection");
                            onChange({ tier: tier.id });
                        }}
                        {...(tier.popular ? { tag: t("create.guests.popular") } : {})}
                    />
                ))}
            </View>
            <View style={styles.addOn}>
                <View style={{ flex: 1 }}>
                    <Text>{t("create.guests.unlimited")}</Text>
                    <Text variant="small" tone="ash">
                        {included
                            ? t("create.guests.included")
                            : t("create.guests.unlimitedPrice", {
                                  price: priceOf(
                                      UNLIMITED_SHOTS.productId,
                                      UNLIMITED_SHOTS.priceCents,
                                      prices,
                                  ),
                              })}
                    </Text>
                </View>
                {included ? (
                    <Icon icon={icons.check} />
                ) : (
                    <Toggle
                        value={draft.unlimited}
                        onChange={(unlimited) =>
                            onChange({
                                unlimited,
                                shots: unlimited
                                    ? UNLIMITED
                                    : draft.shots === UNLIMITED
                                      ? MAX_SHOTS
                                      : draft.shots,
                            })
                        }
                        accessibilityLabel={t("create.guests.unlimited")}
                    />
                )}
            </View>
            {onDelete ? (
                <Pressable
                    onPress={onDelete}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={styles.deleteDraft}
                >
                    <Icon icon={icons.trash} size={17} color={color.ash} />
                    <Text variant="small" tone="ash" weight="medium">
                        {t("create.deleteDraft")}
                    </Text>
                </Pressable>
            ) : null}
        </>
    );
}

// The main action at the bottom of each step

interface FooterProps {
    step: number;
    draft: Draft;
    event: Event | null;
    prices: Record<string, StorePrice>;
    coverState: CoverState;
    ensureEvent: () => Promise<Event>;
    uploadCover: (cover: Cover, eventId: string) => void;
    coverJob: { current: Promise<void> | null };
    onNext: () => void;
    onEvent: (event: Event) => void;
    onStarted: (event: Event) => void;
    onEndPassed: () => void;
    /** Called once Start has created or reached the server's draft. */
    onAttempted: () => void;
}

/** A failure from the store itself, as opposed to the API, during a purchase. */
class StoreFailure extends Error {}

function Footer({
    step,
    draft,
    event,
    prices,
    coverState,
    ensureEvent,
    uploadCover,
    coverJob,
    onNext,
    onEvent,
    onStarted,
    onEndPassed,
    onAttempted,
}: FooterProps) {
    const session = useSession();
    const [busy, setBusy] = useState(false);
    const [problemLine, setProblemLine] = useState<string | null>(null);
    const [nameMissing, setNameMissing] = useState(false);

    // Only what the event doesn't have yet, so a draft reopened after a part-finished purchase
    // shows the right price.
    const owed = due(event, draft.tier, draft.unlimited);
    const blankTitle = step === 2 && draft.title.trim() === "";
    const blocked =
        blankTitle ||
        (step === 2 && problemsAt(draft, "endsAt")) ||
        (step === 3 && problemsAt(draft, "revealAt"));

    if (nameMissing && !blankTitle) setNameMissing(false);

    const fail = (error: unknown, created: boolean) => {
        setBusy(false);
        if (error instanceof PaymentsUnavailable) {
            setProblemLine(t("create.paymentsUnavailable"));
            return;
        }
        if (error instanceof StoreFailure) {
            setProblemLine(t("create.paymentFailedDraft"));
            return;
        }
        const { code, status } = asApiError(error);
        // A dropped session sends the host to sign in; the draft is kept on the device.
        if (status === 401) return;
        if (code === "already-over") {
            setProblemLine(problem("already-over"));
            onEndPassed();
            return;
        }
        if ((code === "network" || code === "timeout") && created) {
            setProblemLine(t("create.offlineDraft"));
            return;
        }
        setProblemLine(problem(code));
    };

    const start = async () => {
        if (!session) return;
        setBusy(true);
        setProblemLine(null);
        let current: Event;
        try {
            current = await ensureEvent();
            onAttempted();
            const patch = changesFrom(current, draft);
            if (Object.keys(patch).length > 0) {
                current = await api.events.update(current.id, patch);
                onEvent(current);
            }
            if (draft.cover && !draft.cover.remote && coverState === "idle") {
                uploadCover(draft.cover, current.id);
            }
            // The cover is optional: a failed upload has already said so and doesn't stop Start.
            await coverJob.current;
        } catch (error) {
            fail(error, event !== null);
            return;
        }
        const eventId = current.id;
        try {
            // Work from the event as the server has it: an earlier purchase may have been applied
            // even though its screen never heard back, and that must not be bought twice.
            await claimPending();
            current = await api.events.get(eventId);
            onEvent(current);
            const wanted = due(current, draft.tier, draft.unlimited);
            if (wanted.cents > 0) {
                const result = await purchase({
                    event: current,
                    hostId: session.host.id,
                    tier: wanted.tier?.id ?? "free",
                    unlimitedShots: wanted.addOn !== null,
                }).catch((error: unknown) => {
                    if (error instanceof ApiError || error instanceof PaymentsUnavailable)
                        throw error;
                    throw new StoreFailure(String(error));
                });
                if (result.kind === "redirected") return;
                onEvent(result.event);
                invalidate("events:");
                if (result.kind === "cancelled") {
                    setBusy(false);
                    const tierPaid =
                        wanted.tier !== null && result.event.guestLimit >= wanted.tier.guests;
                    if (tierPaid && wanted.addOn && !result.event.unlimitedShots && wanted.tier) {
                        setProblemLine(
                            t("create.partlyPaid", {
                                tier: t("create.guests.tier", { count: wanted.tier.guests }),
                            }),
                        );
                    }
                    return;
                }
                current = result.event;
            }
            if (current.state === "draft") current = await api.events.live(current.id);
            setBusy(false);
            onStarted(current);
        } catch (error) {
            fail(error, true);
            api.events
                .get(eventId)
                .then(onEvent)
                .catch(() => null);
        }
    };

    return (
        <>
            {problemLine ? <Notice>{problemLine}</Notice> : null}
            {nameMissing ? <Notice>{t("create.name.required")}</Notice> : null}
            {step < 5 ? (
                // A disabled button doesn't take the tap, so this says why it can't go on.
                <Pressable
                    onPress={() => setNameMissing(true)}
                    disabled={!blankTitle}
                    accessible={false}
                >
                    <Button
                        label={t("common.continue")}
                        disabled={blocked}
                        onPress={() => {
                            setProblemLine(null);
                            onNext();
                        }}
                    />
                </Pressable>
            ) : (
                <>
                    <Button
                        label={
                            owed.cents === 0
                                ? t("create.start")
                                : t("create.startPaid", { price: totalOf(owed, prices) })
                        }
                        loading={busy}
                        onPress={() => {
                            start().catch(() => setBusy(false));
                        }}
                    />
                    {devChrome() && testPurchases() && owed.cents > 0 ? (
                        <Text variant="caption" tone="ash" align="center">
                            {t("create.testPurchase")}
                        </Text>
                    ) : null}
                </>
            )}
        </>
    );
}

const styles = StyleSheet.create({
    // The back button sits on the progress line, so the title starts where the design puts it.
    top: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        height: 26,
        marginTop: -15,
        marginBottom: 15,
    },
    back: { height: 26, justifyContent: "center" },
    cover: {
        height: 210,
        borderRadius: radius.card,
        overflow: "hidden",
        backgroundColor: color.surface,
    },
    coverEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    coverBusy: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(13, 13, 13, 0.35)",
    },
    shots: { fontSize: 28, lineHeight: 30, color: color.paper },
    look: {
        height: 150,
        borderRadius: radius.card,
        overflow: "hidden",
        borderWidth: 2.5,
        borderColor: "transparent",
        backgroundColor: color.surface,
        justifyContent: "center",
    },
    lookText: { paddingLeft: 18 },
    lookName: { fontSize: 30, lineHeight: 32, color: color.white },
    lookDescription: { color: "rgba(255, 255, 255, 0.85)", marginTop: 6 },
    addOn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        paddingVertical: 17,
        marginTop: 8,
    },
    deleteDraft: {
        flexDirection: "row",
        alignItems: "center",
        gap: space.s,
        alignSelf: "center",
        marginTop: space.xl,
    },
    zoneList: { maxHeight: 360 },
});
