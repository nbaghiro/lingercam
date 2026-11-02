import { EMAIL_MAX, NAME_MAX, firstName } from "@linger/core/events";
import { shootingPhase } from "@linger/core/shots";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
    api,
    cached,
    invalidate,
    serverNow,
    setCached,
    storage,
    useAction,
    useLoad,
    useSession,
    type EventSummary,
    type GuestResponse,
} from "@/api";
import { useCameraAccess } from "@/camera";
import { formatWhen, momentsFromPeople, problem, revealWhen, t } from "@/copy";
import { useCode } from "@/event";
import { CodeEntry } from "@/joined";
import { eventMarks, isGone, isRevealed, useEventClock } from "@/shutter";
import {
    Button,
    Field,
    Icon,
    IconButton,
    Mark,
    Notice,
    Text,
    color,
    haptic,
    icons,
    useReduceMotion,
} from "@/ui";
import { setShotsLeft } from "@/uploads";

// The join sheet over the event's blurred cover, as an App Clip would show it: the invite, then
// the guest's name, then the camera. The browser join page is the same screen. The camera step
// only appears when access was refused; otherwise Continue goes straight to the system prompt.

const NAME_KEY = "guestName";
/** Draft, full and not-yet-started sheets check this often, so the guest moves on by themselves. */
const WAITING_POLL_MS = 15_000;

type Step = "invite" | "name" | "camera" | "restore";

function rules(event: EventSummary, now: Date): string {
    const when = revealWhen(now, new Date(event.revealsAt), event.timeZone);
    if (event.shotsPerGuest === null) return t("join.rulesUnlimited", { when });
    if (event.revealMode === "right-away") {
        return t("join.rulesRightAway", { shots: event.shotsPerGuest });
    }
    return t("join.rules", { shots: event.shotsPerGuest, when });
}

/** Draft, full or not yet started: states that end without the guest doing anything. */
function isWaiting(event: EventSummary, now: Date): boolean {
    const phase = shootingPhase(event, now);
    return phase === "before" || (phase === "open" && event.full && event.viewer.role === "none");
}

function restoreProblem(code: string | undefined): string {
    if (code === "bad-link") return t("join.badLink");
    if (code === "already-joined") return t("join.alreadyJoined");
    return problem(code);
}

export function JoinScreen() {
    const code = useCode();
    const params = useLocalSearchParams<{ restore?: string }>();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const reduceMotion = useReduceMotion();
    const session = useSession();
    const known = cached<EventSummary>(`summary:${code}`);
    const waiting = known !== undefined && isWaiting(known, serverNow());
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code), {
        intervalMs: waiting ? WAITING_POLL_MS : null,
    });
    const access = useCameraAccess();
    const join = useAction((name: string) => api.guest.join(code, name));
    const restore = useAction((token: string) => api.guest.restore(code, token));
    const sendRestore = useAction((email: string) => api.guest.sendRestore(code, email));
    const [step, setStep] = useState<Step>("invite");
    const [storedName] = useState(
        () => storage.getString(NAME_KEY) ?? session?.host.name ?? undefined,
    );
    const [name, setName] = useState(storedName ?? "");
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [asking, setAsking] = useState(false);

    const event = summary.data;
    const now = useEventClock(eventMarks(event));
    const gone = isGone(event, summary.error);
    const member = event !== undefined && event.viewer.role !== "none";
    const phase = event ? shootingPhase(event, now) : null;
    // A right-away event is revealed from its start, but while the camera can open the sheet
    // still invites guests to shoot.
    const revealed = event !== undefined && isRevealed(event, now) && phase === "closed";
    const full = event !== undefined && event.full && !member && phase === "open";

    // The event sits under the camera, so leaving the camera lands on the event.
    const go = (camera: boolean) => {
        router.replace(`/e/${code}` as Href);
        if (camera) router.push(`/e/${code}/camera` as Href);
    };

    const joined = (result: GuestResponse) => {
        haptic("success");
        setCached(`me:${code}`, result);
        setShotsLeft(code, result.shotsLeft);
        invalidate(`summary:${code}`);
    };

    // An email link moves the guest to this device, then opens the event.
    const restoring = useRef(false);
    const restoreFrom = useEffectEvent((token: string) => {
        restore
            .run(token)
            .then((result) => {
                if (!result) return;
                joined(result);
                go(false);
            })
            .catch(() => null);
    });
    useEffect(() => {
        if (!params.restore || restoring.current) return;
        restoring.current = true;
        restoreFrom(params.restore);
    }, [params.restore]);

    /** Asks for the camera where needed, then opens it. The step shows only when refused. */
    const openCamera = async () => {
        if (access.granted === true && Platform.OS !== "web") {
            go(true);
            return;
        }
        if (!access.canAsk) {
            setStep("camera");
            return;
        }
        setAsking(true);
        const granted = await access.request().catch(() => false);
        setAsking(false);
        if (granted) go(true);
        else setStep("camera");
    };

    const afterJoin = () => {
        if (phase === "open") return openCamera();
        go(false);
        return Promise.resolve();
    };

    const joinAs = async (as: string) => {
        const trimmed = as.trim();
        if (!trimmed) return;
        const result = await join.run(trimmed);
        if (!result) return;
        storage.set(NAME_KEY, trimmed);
        joined(result);
        await afterJoin();
    };

    const primary = () => {
        if (member) return afterJoin();
        if (storedName) return joinAs(storedName);
        setStep("name");
        return Promise.resolve();
    };

    const sendLink = async () => {
        const trimmed = email.trim();
        if (!trimmed) return;
        const result = await sendRestore.run(trimmed);
        if (result !== undefined) setSent(true);
    };

    const run = (task: () => Promise<unknown>) => () => {
        task().catch(() => null);
    };

    let content: ReactNode;
    if (!event && summary.error?.code === "not-found") {
        content = (
            <>
                <Title>{t("join.notFoundTitle")}</Title>
                <Line>{t("join.notFoundBody")}</Line>
                <CodeEntry
                    initialCode={code}
                    onSubmit={(next) => router.replace(`/j/${next}` as Href)}
                />
            </>
        );
    } else if (!event && summary.error) {
        content = (
            <>
                <Title>{t("join.offlineTitle")}</Title>
                <Line>{t("join.offlineBody")}</Line>
                <Button label={t("common.retry")} onPress={summary.reload} />
            </>
        );
    } else if (!event) {
        content = <Placeholder />;
    } else if (gone) {
        content = (
            <>
                <Title>{t("event.gone")}</Title>
                <Button
                    label={t("event.backToEvents")}
                    onPress={() => router.replace("/" as Href)}
                />
            </>
        );
    } else if (step === "name") {
        content = (
            <>
                <Back onPress={() => setStep("invite")} />
                <Title>{t("join.nameTitle")}</Title>
                <Line>{t("join.nameBody")}</Line>
                <Field
                    value={name}
                    onChangeText={setName}
                    placeholder={t("join.namePlaceholder")}
                    maxLength={NAME_MAX}
                    autoFocus
                    autoCapitalize="words"
                    autoComplete="given-name"
                    textContentType="givenName"
                    returnKeyType="go"
                    onSubmitEditing={run(() => joinAs(name))}
                    style={{ textAlign: "center", marginBottom: 6 }}
                    accessibilityLabel={t("join.namePlaceholder")}
                />
                {join.error ? <Notice>{problem(join.error.code)}</Notice> : null}
                <Button
                    label={t("common.continue")}
                    loading={join.busy || asking}
                    disabled={name.trim().length === 0}
                    onPress={run(() => joinAs(name))}
                />
            </>
        );
    } else if (step === "camera") {
        const web = Platform.OS === "web";
        content = (
            <>
                <View style={styles.cameraIcon}>
                    <Icon icon={icons.camera} size={40} weight="duotone" />
                </View>
                <Title>{t("join.cameraTitle")}</Title>
                <Line>{web ? t("camera.webDenied") : t("join.cameraDenied")}</Line>
                {web || access.canAsk ? (
                    <Button
                        label={t("common.retry")}
                        icon={icons.camera}
                        loading={asking}
                        onPress={run(openCamera)}
                    />
                ) : (
                    <Button label={t("join.openSettings")} onPress={access.openSettings} />
                )}
            </>
        );
    } else if (step === "restore") {
        content = (
            <>
                <Back onPress={() => setStep("invite")} />
                <Title>{t("join.restoreTitle")}</Title>
                <Line>{sent ? t("join.restoreSent") : t("join.restoreBody")}</Line>
                {sent ? null : (
                    <>
                        <Field
                            value={email}
                            onChangeText={setEmail}
                            placeholder={t("join.restoreEmail")}
                            maxLength={EMAIL_MAX}
                            autoFocus
                            autoCapitalize="none"
                            autoComplete="email"
                            keyboardType="email-address"
                            textContentType="emailAddress"
                            returnKeyType="send"
                            onSubmitEditing={run(sendLink)}
                            style={{ textAlign: "center", marginBottom: 6 }}
                            accessibilityLabel={t("join.restoreEmail")}
                        />
                        {sendRestore.error ? (
                            <Notice>{problem(sendRestore.error.code)}</Notice>
                        ) : null}
                        <Button
                            label={t("join.restoreSend")}
                            loading={sendRestore.busy}
                            disabled={email.trim().length === 0}
                            onPress={run(sendLink)}
                        />
                    </>
                )}
            </>
        );
    } else {
        content = (
            <Invite
                event={event}
                now={now}
                member={member}
                phase={phase}
                revealed={revealed}
                full={full}
                storedName={storedName}
                busy={join.busy || asking || restore.busy}
                problemLine={
                    restore.error
                        ? restoreProblem(restore.error.code)
                        : join.error
                          ? problem(join.error.code)
                          : null
                }
                restoring={restore.busy}
                onPrimary={run(primary)}
                onSeeEvent={() => go(false)}
                onRetry={summary.reload}
                onNotMe={() => {
                    setName("");
                    setStep("name");
                }}
                onOtherDevice={() => {
                    setSent(false);
                    setStep("restore");
                }}
            />
        );
    }

    return (
        <View style={styles.screen}>
            {event?.coverUrl ? (
                <Image
                    source={event.coverUrl}
                    style={[StyleSheet.absoluteFill, styles.backdrop]}
                    contentFit="cover"
                    blurRadius={4}
                />
            ) : null}
            <View style={[StyleSheet.absoluteFill, styles.dim]} />
            <KeyboardAvoidingView
                style={styles.fill}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom - 24, 10) }]}>
                    <Animated.View
                        {...(reduceMotion ? {} : { layout: LinearTransition.duration(220) })}
                        style={styles.sheet}
                    >
                        <Animated.View
                            key={`${step}-${event ? "ready" : "loading"}`}
                            entering={FadeIn.duration(220)}
                            style={styles.content}
                        >
                            {content}
                        </Animated.View>
                    </Animated.View>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

interface InviteProps {
    event: EventSummary;
    now: Date;
    member: boolean;
    phase: ReturnType<typeof shootingPhase> | null;
    revealed: boolean;
    full: boolean;
    storedName: string | undefined;
    busy: boolean;
    problemLine: string | null;
    restoring: boolean;
    onPrimary: () => void;
    onSeeEvent: () => void;
    onRetry: () => void;
    onNotMe: () => void;
    onOtherDevice: () => void;
}

/** The first step: cover, byline, title, the rules and one button, per the event's state. */
function Invite({
    event,
    now,
    member,
    phase,
    revealed,
    full,
    storedName,
    busy,
    problemLine,
    restoring,
    onPrimary,
    onSeeEvent,
    onRetry,
    onNotMe,
    onOtherDevice,
}: InviteProps) {
    const reveal = revealWhen(now, new Date(event.revealsAt), event.timeZone);
    let title: string;
    let line: string | null;
    let rulesLine: string | null = null;
    let action: ReactNode;
    let below: ReactNode = null;

    const joinLabel = !member && storedName ? t("join.as", { name: storedName }) : null;
    const notMe =
        joinLabel && storedName ? (
            <TextLink label={t("join.notMe", { name: storedName })} onPress={onNotMe} />
        ) : null;

    if (event.state === "draft") {
        title = t("join.draftTitle", { title: event.title });
        line = t("join.draftBody");
        action = <Button label={t("common.retry")} variant="dark" onPress={onRetry} />;
    } else if (revealed && member) {
        title = t("join.revealedTitle");
        line = t("join.countsLine", {
            counts: momentsFromPeople(event.photoCount, event.photographerCount),
        });
        action = <Button label={t("join.seePhotos")} onPress={onSeeEvent} />;
    } else if (revealed) {
        title = t("join.notMemberTitle");
        line = t("join.notMemberBody");
        action = <Button label={t("join.otherDevice")} variant="dark" onPress={onOtherDevice} />;
    } else if (phase === "closed") {
        title = t("join.endedTitle");
        line = t("join.endedBody", { when: reveal });
        action = <Button label={t("join.seeEvent")} onPress={onSeeEvent} />;
    } else if (full) {
        title = t("join.fullTitle", { title: event.title });
        line = t("join.fullBody");
        action = <Button label={t("common.retry")} variant="dark" onPress={onRetry} />;
    } else if (phase === "before") {
        title = t("join.invited", { title: event.title });
        line = t("join.opensWhen", {
            when: formatWhen(now, new Date(event.startsAt), event.timeZone),
        });
        rulesLine = `${rules(event, now)} ${t("join.cameraOnly")}`;
        action = (
            <Button
                label={member ? t("join.seeEvent") : (joinLabel ?? t("join.joinNow"))}
                loading={busy}
                onPress={onPrimary}
            />
        );
        below = notMe;
    } else {
        title = t("join.invited", { title: event.title });
        line = rules(event, now);
        rulesLine = t("join.cameraOnly");
        action = (
            <Button
                label={joinLabel ?? t("join.openCamera")}
                icon={icons.camera}
                loading={busy}
                onPress={onPrimary}
            />
        );
        below = notMe;
    }

    return (
        <>
            <View style={styles.photo}>
                {event.coverUrl ? (
                    <Image
                        source={event.coverUrl}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={200}
                    />
                ) : (
                    <View style={[StyleSheet.absoluteFill, styles.noCover]}>
                        <Mark size={56} tint={color.faint} />
                    </View>
                )}
            </View>
            <View style={styles.by}>
                <Mark size={16} tint={color.ash} />
                <Text variant="small" tone="ash" style={{ fontSize: 14 }}>
                    {event.hostName
                        ? t("join.byHost", { name: firstName(event.hostName) })
                        : t("join.by")}
                </Text>
            </View>
            <Title>{title}</Title>
            {line ? <Line>{line}</Line> : null}
            {rulesLine ? <Line>{rulesLine}</Line> : null}
            {restoring ? <Line>{t("join.restoring")}</Line> : null}
            {problemLine ? <Notice>{problemLine}</Notice> : null}
            {action}
            {below}
        </>
    );
}

function Title({ children }: { children: string }) {
    return (
        <Text variant="heading" align="center" accessibilityRole="header">
            {children}
        </Text>
    );
}

function Line({ children }: { children: string }) {
    return (
        <Text variant="small" tone="ash" align="center">
            {children}
        </Text>
    );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} accessibilityRole="button" hitSlop={10} style={styles.link}>
            <Text variant="small" tone="ash" align="center" style={styles.linkText}>
                {label}
            </Text>
        </Pressable>
    );
}

function Back({ onPress }: { onPress: () => void }) {
    return (
        <View style={styles.back}>
            <IconButton icon={icons.back} onPress={onPress} accessibilityLabel={t("common.back")} />
        </View>
    );
}

/** The sheet's shape while the event loads: the cover as a Surface block and two lines. */
function Placeholder() {
    return (
        <View accessible accessibilityLabel={t("join.loading")} style={{ gap: 14 }}>
            <View style={styles.photo} />
            <View style={[styles.bar, { width: "40%" }]} />
            <View style={[styles.bar, styles.barTall, { width: "80%" }]} />
            <View style={[styles.bar, { width: "65%" }]} />
            <View style={styles.buttonShape} />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night, overflow: "hidden" },
    backdrop: { transform: [{ scale: 1.08 }] },
    dim: { backgroundColor: "rgba(13, 13, 13, 0.45)" },
    fill: { flex: 1, justifyContent: "flex-end" },
    dock: { paddingHorizontal: 10, alignItems: "center" },
    sheet: {
        borderRadius: 52,
        backgroundColor: color.sheet,
        paddingTop: 24,
        paddingHorizontal: 24,
        paddingBottom: 40,
        width: "100%",
        maxWidth: 460,
        overflow: "hidden",
    },
    content: { gap: 14 },
    photo: { height: 220, borderRadius: 26, overflow: "hidden", backgroundColor: color.surface },
    noCover: { alignItems: "center", justifyContent: "center" },
    by: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
    cameraIcon: { alignItems: "center", paddingVertical: 12 },
    back: { flexDirection: "row" },
    link: { alignSelf: "center", paddingVertical: 4 },
    linkText: { textDecorationLine: "underline" },
    bar: {
        height: 12,
        borderRadius: 6,
        backgroundColor: color.surface,
        alignSelf: "center",
    },
    barTall: { height: 22, borderRadius: 8 },
    buttonShape: { height: 56, borderRadius: 18, backgroundColor: color.surface },
});
