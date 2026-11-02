import {
    DEFAULT_SHOTS,
    MAX_SHOTS,
    MIN_SHOTS,
    OCCASIONS,
    TITLE_MAX,
    settingsProblems,
    type Event,
    type EventSettings,
    type Occasion,
    type RevealMode,
    type Visibility,
} from "@linger/core/events";
import { DEFAULT_LOOK, LOOK_IDS, LOOKS, type LookId } from "@linger/core/film";
import { TIERS, UNLIMITED_SHOTS, due, formatPrice, type TierId } from "@linger/core/pricing";
import { revealTime } from "@linger/core/reveal";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Platform, Pressable, Share, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { api, joinLink, uploadFile, useLoad, useSession } from "@/api";
import {
    formatDay,
    formatEnds,
    occasionLabel,
    revealModeLabel,
    revealWhen,
    t,
    visibilityLabel,
} from "@/copy";
import { HostAppNote } from "@/home";
import { LookImage } from "@/look";
import { claimPending, purchase } from "@/purchase";
import {
    Button,
    Icon,
    IconButton,
    InviteCard,
    KeyValue,
    Label,
    Notice,
    OptionRow,
    Progress,
    Screen,
    Segmented,
    Sheet,
    Slider,
    Text,
    TierRow,
    Toggle,
    Field,
    color,
    type QrHandle,
    icons,
    occasionIcons,
} from "@/ui";

type Mode = Exclude<RevealMode, "custom">;

interface Draft {
    occasion: Occasion;
    title: string;
    startsAt: Date;
    endsAt: Date;
    cover: { uri: string; mimeType: string } | null;
    revealMode: Mode;
    /** MIN_SHOTS to MAX_SHOTS, or UNLIMITED. */
    shots: number;
    visibility: Visibility;
    look: LookId;
    tier: TierId;
    unlimited: boolean;
}

const UNLIMITED = MAX_SHOTS + 1;

const SHOT_STOPS = [
    { value: MIN_SHOTS, label: String(MIN_SHOTS) },
    { value: 15, label: "15" },
    { value: DEFAULT_SHOTS, label: String(DEFAULT_SHOTS) },
    { value: MAX_SHOTS, label: String(MAX_SHOTS) },
    { value: UNLIMITED, label: "∞" },
] as const;

const MODES: readonly Mode[] = ["right-away", "at-end", "next-morning"];

/** What each occasion suggests: when it ends (days after the start, at an hour), and the rules. */
const SUGGESTIONS: Record<
    Occasion,
    { endDays: number; endHour: number; revealMode: Mode; shots: number; tier: TierId }
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

const HOUR = 3_600_000;

function startOfDay(at: Date): Date {
    return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

function suggestedEnd(occasion: Occasion, startsAt: Date): Date {
    const s = SUGGESTIONS[occasion];
    const day = startOfDay(startsAt);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + s.endDays, s.endHour);
    if (end.getTime() > Math.max(startsAt.getTime(), Date.now()) + HOUR) return end;
    // The suggested hour has passed: give the event the rest of the evening.
    const later = new Date(Math.max(startsAt.getTime(), Date.now()) + 3 * HOUR);
    later.setMinutes(0, 0, 0);
    return later;
}

function newDraft(occasion: Occasion): Draft {
    const startsAt = new Date();
    startsAt.setSeconds(0, 0);
    const s = SUGGESTIONS[occasion];
    return {
        occasion,
        title: "",
        startsAt,
        endsAt: suggestedEnd(occasion, startsAt),
        cover: null,
        revealMode: s.revealMode,
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
        cover: null,
        revealMode: s.revealMode === "custom" ? "at-end" : s.revealMode,
        shots: s.shotsPerGuest ?? UNLIMITED,
        visibility: s.visibility,
        look: s.look,
        tier: event.tier,
        unlimited: event.unlimitedShots,
    };
}

const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

function settingsOf(draft: Draft): EventSettings {
    return {
        occasion: draft.occasion,
        title: draft.title.trim(),
        startsAt: draft.startsAt.toISOString(),
        endsAt: draft.endsAt.toISOString(),
        timeZone: timeZone(),
        revealMode: draft.revealMode,
        // Unlimited needs the add-on. The purchase switches the event to unlimited once it's paid.
        shotsPerGuest: Math.min(draft.shots, MAX_SHOTS),
        visibility: draft.visibility,
        look: draft.look,
    };
}

/** When the draft's photos would appear. Once the event exists, the server's revealsAt is used. */
function whenPhrase(draft: Draft): string {
    return revealWhen(new Date(), revealTime(settingsOf(draft)));
}

/** True when the draft's dates don't hold together, by core's own settings rules. */
function datesWrong(draft: Draft): boolean {
    return settingsProblems(settingsOf(draft)).some((p) => p.path === "endsAt");
}

export function CreateScreen() {
    if (Platform.OS === "web") return <HostAppNote />;
    return <Create />;
}

function Create() {
    const router = useRouter();
    const params = useLocalSearchParams<{ event?: string }>();
    const resumeId = typeof params.event === "string" ? params.event : null;
    const resume = useLoad(resumeId, () => api.events.get(resumeId ?? ""));

    const [step, setStep] = useState(1);
    const [draft, setDraft] = useState<Draft>(() => newDraft("wedding"));
    const [event, setEvent] = useState<Event | null>(null);
    const [resumed, setResumed] = useState<string | null>(null);

    // A draft opened from the events list continues at the price step.
    if (resume.data && resumed !== resume.data.id) {
        setResumed(resume.data.id);
        setDraft(fromEvent(resume.data));
        setEvent(resume.data);
        setStep(5);
    }

    const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
    };

    const back = () => {
        if (step === 1 || step === 6 || (step === 5 && resumeId)) leave();
        else setStep(step - 1);
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

    if (step === 6 && event) return <Invite event={event} onDone={leave} />;

    return (
        <Screen
            scroll
            footer={
                <Footer
                    step={step}
                    draft={draft}
                    event={event}
                    onNext={() => setStep(step + 1)}
                    onStarted={(started) => {
                        setEvent(started);
                        setStep(6);
                    }}
                    onCreated={setEvent}
                />
            }
        >
            <View style={styles.top}>
                <Pressable
                    onPress={back}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.back")}
                    hitSlop={12}
                    style={styles.back}
                >
                    <Icon icon={step === 1 ? icons.close : icons.back} size={22} />
                </Pressable>
                <View style={{ flex: 1 }}>
                    <Progress step={step} />
                </View>
            </View>
            {step === 1 ? (
                <OccasionStep
                    value={draft.occasion}
                    onChange={(occasion) =>
                        setDraft((d) => ({
                            ...newDraft(occasion),
                            title: d.title,
                            cover: d.cover,
                            startsAt: d.startsAt,
                            endsAt: suggestedEnd(occasion, d.startsAt),
                        }))
                    }
                />
            ) : step === 2 ? (
                <NameStep draft={draft} onChange={update} />
            ) : step === 3 ? (
                <RulesStep draft={draft} onChange={update} />
            ) : step === 4 ? (
                <LookStep draft={draft} onChange={update} />
            ) : (
                <GuestsStep draft={draft} onChange={update} />
            )}
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

function NameStep({ draft, onChange }: StepProps) {
    const [picking, setPicking] = useState<"start" | "end" | null>(null);
    const zone = timeZone();

    const pickCover = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.85,
        });
        const asset = result.canceled ? undefined : result.assets[0];
        if (asset)
            onChange({ cover: { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" } });
    };

    const setStart = (date: Date) => {
        const today = startOfDay(new Date()).getTime() === startOfDay(date).getTime();
        const startsAt = today ? new Date() : startOfDay(date);
        startsAt.setSeconds(0, 0);
        // Keep the event's length when the day moves.
        const length = draft.endsAt.getTime() - draft.startsAt.getTime();
        onChange({ startsAt, endsAt: new Date(startsAt.getTime() + Math.max(length, HOUR)) });
    };

    const setEnd = (date: Date) => {
        onChange({ endsAt: date });
    };

    const open = (which: "start" | "end") => {
        if (Platform.OS !== "android") {
            setPicking(which);
            return;
        }
        if (which === "start") {
            DateTimePickerAndroid.open({
                value: draft.startsAt,
                mode: "date",
                minimumDate: startOfDay(new Date()),
                onValueChange: (_, date) => setStart(date),
            });
            return;
        }
        DateTimePickerAndroid.open({
            value: draft.endsAt,
            mode: "date",
            minimumDate: startOfDay(draft.startsAt),
            onValueChange: (_, day) =>
                DateTimePickerAndroid.open({
                    value: draft.endsAt,
                    mode: "time",
                    is24Hour: true,
                    onValueChange: (__, time) => {
                        const end = new Date(day);
                        end.setHours(time.getHours(), time.getMinutes(), 0, 0);
                        setEnd(end);
                    },
                }),
        });
    };

    const endsBeforeStart = datesWrong(draft);

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
            <View style={{ marginTop: 6 }}>
                <KeyValue
                    label={t("create.name.date")}
                    value={formatDay(draft.startsAt, zone)}
                    onPress={() => open("start")}
                />
                <KeyValue
                    label={t("create.name.ends")}
                    value={formatEnds(draft.startsAt, draft.endsAt, zone)}
                    onPress={() => open("end")}
                />
            </View>
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
            </Pressable>

            <DateSheet
                visible={picking !== null}
                mode={picking === "end" ? "datetime" : "date"}
                value={picking === "end" ? draft.endsAt : draft.startsAt}
                minimumDate={
                    picking === "end"
                        ? new Date(draft.startsAt.getTime() + HOUR / 4)
                        : startOfDay(new Date())
                }
                onChange={(date) => (picking === "end" ? setEnd(date) : setStart(date))}
                onClose={() => setPicking(null)}
            />
        </>
    );
}

interface DateSheetProps {
    visible: boolean;
    mode: "date" | "datetime";
    value: Date;
    minimumDate: Date;
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
                    minimumDate={minimumDate}
                    themeVariant="dark"
                    accentColor={color.candle}
                    textColor={color.paper}
                    locale="en-GB"
                    minuteInterval={5}
                    onValueChange={(_, date) => onChange(date)}
                />
            </View>
            <Button label={t("common.done")} onPress={onClose} />
        </Sheet>
    );
}

function RulesStep({ draft, onChange }: StepProps) {
    const unlimited = draft.shots === UNLIMITED;
    return (
        <>
            <Text variant="title" accessibilityRole="header">
                {t("create.rules.title")}
            </Text>
            <Label>{t("create.rules.when")}</Label>
            <Segmented
                options={MODES.map((m) => ({ value: m, label: revealModeLabel(m) }))}
                value={draft.revealMode}
                onChange={(revealMode) => onChange({ revealMode })}
                accessibilityLabel={t("create.rules.when")}
            />
            <Text variant="small" tone="ash" style={{ marginTop: 10 }}>
                {draft.revealMode === "right-away"
                    ? t("create.rules.rightAwayNote")
                    : t("create.rules.whenNote", { when: whenPhrase(draft) })}
            </Text>
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
                            onPress={() => onChange({ look: id })}
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

function GuestsStep({ draft, onChange }: StepProps) {
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
                        price={formatPrice(tier.priceCents)}
                        selected={tier.id === draft.tier}
                        onPress={() => onChange({ tier: tier.id })}
                        {...(tier.popular ? { tag: t("create.guests.popular") } : {})}
                    />
                ))}
            </View>
            <View style={styles.addOn}>
                <View style={{ flex: 1 }}>
                    <Text>{t("create.guests.unlimited")}</Text>
                    <Text variant="small" tone="ash">
                        {t("create.guests.unlimitedPrice", {
                            price: formatPrice(UNLIMITED_SHOTS.priceCents),
                        })}
                    </Text>
                </View>
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
            </View>
        </>
    );
}

// The main action at the bottom of each step

interface FooterProps {
    step: number;
    draft: Draft;
    event: Event | null;
    onNext: () => void;
    onCreated: (event: Event) => void;
    onStarted: (event: Event) => void;
}

function Footer({ step, draft, event, onNext, onCreated, onStarted }: FooterProps) {
    const session = useSession();
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);

    // Only what the event doesn't have yet, so a draft reopened after a part-finished purchase
    // shows the right price.
    const { cents } = due(event, draft.tier, draft.unlimited);
    const blocked = (step === 2 && draft.title.trim() === "") || (step === 2 && datesWrong(draft));

    const start = async () => {
        if (!session) return;
        setBusy(true);
        setProblem(null);
        let current = event;
        try {
            if (!current) {
                current = await api.events.create(settingsOf(draft));
                onCreated(current);
                if (draft.cover) {
                    const cover = draft.cover;
                    const { uploadUrl } = await api.events.cover(current.id, cover.mimeType);
                    // The cover is optional, so a failed upload doesn't stop the event.
                    await uploadFile(uploadUrl, cover.uri, cover.mimeType).catch(() => null);
                }
            }
        } catch {
            setBusy(false);
            setProblem(t("create.failed"));
            return;
        }
        const eventId = current.id;
        try {
            // Work from the event as the server has it: an earlier purchase may have been applied
            // even though its screen never heard back, and that must not be bought twice.
            await claimPending();
            current = await api.events.get(eventId);
            onCreated(current);
            const owed = due(current, draft.tier, draft.unlimited);
            if (owed.cents > 0) {
                const result = await purchase({
                    event: current,
                    hostId: session.host.id,
                    tier: owed.tier?.id ?? "free",
                    unlimitedShots: owed.addOn !== null,
                });
                if (result.kind === "cancelled") onCreated(result.event);
                if (result.kind !== "paid") {
                    setBusy(false);
                    return;
                }
                current = result.event;
                onCreated(current);
            }
            if (current.state === "draft") current = await api.events.live(current.id);
            onStarted(current);
        } catch {
            setProblem(t("create.paymentFailed"));
            api.events
                .get(eventId)
                .then(onCreated)
                .catch(() => null);
        }
        setBusy(false);
    };

    return (
        <>
            {problem ? <Notice>{problem}</Notice> : null}
            {step < 5 ? (
                <Button label={t("common.continue")} disabled={blocked} onPress={onNext} />
            ) : (
                <Button
                    label={
                        cents === 0
                            ? t("create.start")
                            : t("create.startPaid", { price: formatPrice(cents) })
                    }
                    loading={busy}
                    onPress={() => {
                        start().catch(() => setBusy(false));
                    }}
                />
            )}
        </>
    );
}

// The invite card

function Invite({ event, onDone }: { event: Event; onDone: () => void }) {
    const url = joinLink(event.code);
    const title = event.settings.title;
    const qr = useRef<QrHandle | null>(null);
    const [printing, setPrinting] = useState(false);

    const print = () => {
        const ref = qr.current;
        if (!ref) return;
        setPrinting(true);
        ref.toDataURL((data) => {
            Print.printAsync({ html: tableCards(event, data) })
                .catch(() => null)
                .finally(() => setPrinting(false));
        });
    };

    const share = () => {
        Share.share({
            message: t("create.invite.shareMessage", { title, url }),
            ...(Platform.OS === "ios" ? { url } : {}),
        }).catch(() => null);
    };

    return (
        <Screen
            footer={
                <View style={{ gap: 10 }}>
                    <Button
                        label={t("create.invite.print")}
                        icon={icons.print}
                        loading={printing}
                        onPress={print}
                    />
                    <Button
                        label={t("create.invite.share")}
                        icon={icons.share}
                        variant="dark"
                        onPress={share}
                    />
                </View>
            }
        >
            <View style={styles.inviteHead}>
                <Text variant="title" align="center" accessibilityRole="header">
                    {t("create.invite.title")}
                </Text>
                <View style={styles.inviteClose}>
                    <IconButton
                        icon={icons.close}
                        onPress={onDone}
                        accessibilityLabel={t("create.invite.done")}
                    />
                </View>
            </View>
            <InviteCard
                title={title}
                url={url}
                caption={t("create.invite.scan")}
                qrRef={(ref) => {
                    qr.current = ref;
                }}
            />
        </Screen>
    );
}

function escape(text: string): string {
    return text.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
    );
}

/** Four table cards on one A4 or Letter page, to cut out and fold. */
function tableCards(event: Event, qrPng: string): string {
    const { title, revealMode, timeZone: zone } = event.settings;
    const how =
        revealMode === "right-away"
            ? t("print.howRightAway")
            : t("print.how", { when: revealWhen(new Date(), new Date(event.revealsAt), zone) });
    const card = `<div class="card">
        <svg width="28" height="28" viewBox="0 0 32 32"><circle cx="12" cy="16" r="9" fill="none" stroke="#121210" stroke-width="2.2"/><circle cx="20" cy="16" r="9" fill="#121210" fill-opacity=".9"/></svg>
        <p class="scan">${escape(t("print.scan"))}</p>
        <img src="data:image/png;base64,${qrPng}" alt="">
        <h2>${escape(title)}</h2>
        <p class="how">${escape(how)}</p>
    </div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(t("print.title", { title }))}</title>
    <link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz@6..72&display=swap" rel="stylesheet">
    <style>
        @page { margin: 12mm; }
        body { margin: 0; font-family: -apple-system, "Helvetica Neue", sans-serif; color: #121210; }
        .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
        .card { border: 1px dashed #c9c6bf; border-radius: 6mm; padding: 9mm 7mm; text-align: center; break-inside: avoid; }
        .scan { font-size: 11pt; color: #6D6B65; margin: 4mm 0; }
        img { width: 46mm; height: 46mm; }
        h2 { font-family: Newsreader, Georgia, serif; font-weight: 400; font-size: 20pt; margin: 4mm 0 2mm; }
        .how { font-size: 9pt; color: #6D6B65; margin: 0; }
    </style></head><body><div class="sheet">${card.repeat(4)}</div></body></html>`;
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
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: color.surface,
    },
    coverEmpty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
    shots: { fontSize: 28, lineHeight: 30, color: color.paper },
    look: {
        height: 150,
        borderRadius: 22,
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
    inviteHead: { marginTop: 6, justifyContent: "center" },
    // Beside the centred title, as the design has no row above it.
    inviteClose: { position: "absolute", left: 0, top: -6 },
});
