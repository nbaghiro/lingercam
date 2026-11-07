import { dueState, type Event } from "@linger/core/events";
import { shootingPhase } from "@linger/core/shots";
import Constants from "expo-constants";
import { Image } from "expo-image";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import {
    ActionSheetIOS,
    Alert,
    Linking,
    Platform,
    Pressable,
    RefreshControl,
    Text as RNText,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import {
    devChrome,
    SITE_URL,
    api,
    asApiError,
    cached,
    dismissSignedOutNotice,
    invalidate,
    joinLink,
    serverNow,
    siteLink,
    storage,
    useAction,
    useLoad,
    useOnForeground,
    useSession,
    useSignedOutNotice,
    type Session,
} from "@/api";
import {
    dayLabel,
    deviceZone,
    formatDay,
    formatDuration,
    formatWhen,
    problem,
    revealLabel,
    stateLabel,
    t,
} from "@/copy";
import { InviteSheet, shareLink } from "@/invite";
import { CodeEntry, JoinedEvents } from "@/joined";
import { hasPendingClaims } from "@/purchase";
import {
    Button,
    Icon,
    IconButton,
    Input,
    Mark,
    Notice,
    Row,
    RowGroup,
    Screen,
    Sheet,
    Text,
    Wordmark,
    color,
    confirm,
    Scrim,
    gutter,
    haptic,
    icons,
    occasionIcons,
    radius,
    showToast,
    space,
    useReduceMotion,
} from "@/ui";
import { useShots } from "@/uploads";

const WELCOME_PHOTO = require("../assets/demo/w-hero.jpg");

/** The key the host's events load under, shared by the list, Settings and create. */
const eventsKey = (hostId: string) => `events:${hostId}`;

/**
 * Set while an email sign-in is being verified. The session arrives before the verify call
 * returns, so the events list reads this to know the sign-in came through email.
 */
const EMAIL_SIGN_IN_KEY = "emailSignIn";

/** Behind the welcome text: a fade into Night, then Night nearly opaque. */
const WELCOME_FADE = [
    [0, 0],
    [1, 0.9],
] as const satisfies readonly [number, number][];
const WELCOME_SHADE = "rgba(13, 13, 13, 0.9)";

/** Long enough for a closing sheet to finish leaving. */
const SHEET_GONE_MS = 500;

/** An account this new is treated as a first sign-in. */
const NEW_ACCOUNT_MS = 10 * 60_000;

export function HomeScreen() {
    const session = useSession();
    if (Platform.OS === "web") return <GuestHome />;
    if (!session) return <Welcome />;
    return <Events session={session} />;
}

// Signed out

function Welcome() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [signingIn, setSigningIn] = useState(false);
    const [enteringCode, setEnteringCode] = useState(false);
    const demo = useAction(api.auth.demo);
    // Read once: the notice shows on this visit to Welcome and not again.
    const signedOut = useSignedOutNotice();
    const [showSignedOut] = useState(signedOut);
    useEffect(() => {
        dismissSignedOutNotice();
    }, []);

    return (
        <View style={styles.fill}>
            <Image source={WELCOME_PHOTO} style={styles.welcomePhoto} contentFit="cover" />
            <Svg style={styles.welcomePhoto} pointerEvents="none">
                <Defs>
                    <LinearGradient id="welcome" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset={0} stopColor={color.night} stopOpacity={0.3} />
                        <Stop offset={0.45} stopColor={color.night} stopOpacity={0.1} />
                        <Stop offset={1} stopColor={color.night} stopOpacity={1} />
                    </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#welcome)" />
            </Svg>
            <ScrollView
                style={styles.fill0}
                contentContainerStyle={[
                    styles.welcomeBody,
                    { paddingBottom: Math.max(insets.bottom, 12) + 10, paddingTop: insets.top },
                ]}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.welcomeText}>
                    {/* With events joined, the text rises over the photo; this keeps it on dark. */}
                    <View style={styles.welcomeFade} pointerEvents="none">
                        <Scrim stops={WELCOME_FADE} />
                    </View>
                    <View style={styles.welcomeShade} pointerEvents="none" />
                    <Wordmark size={34} />
                    <Text variant="display" style={{ marginTop: 22 }}>
                        {t("welcome.title")}
                    </Text>
                    <Text variant="small" tone="ash" style={{ marginTop: 12, marginBottom: 28 }}>
                        {t("welcome.body")}
                    </Text>
                    {showSignedOut ? <Notice>{problem("signed-out")}</Notice> : null}
                    <JoinedEvents onOpen={(code) => router.push(`/e/${code}` as Href)} />
                    <View style={{ gap: 10 }}>
                        <Button
                            label={t("welcome.email")}
                            icon={icons.email}
                            onPress={() => setSigningIn(true)}
                        />
                        {devChrome() ? (
                            <Button
                                label={t("welcome.demo")}
                                variant="dark"
                                loading={demo.busy}
                                onPress={() => {
                                    demo.run().then((session) => {
                                        if (session) haptic("success");
                                    });
                                }}
                            />
                        ) : null}
                    </View>
                    {demo.error ? <Notice>{problem(demo.error.code)}</Notice> : null}
                    <Pressable
                        onPress={() => setEnteringCode(true)}
                        accessibilityRole="button"
                        hitSlop={8}
                        style={{ alignSelf: "center", marginTop: space.l }}
                    >
                        <Text variant="small" tone="ash" weight="medium">
                            {t("welcome.haveCode")}
                        </Text>
                    </Pressable>
                    <LegalLine />
                </View>
            </ScrollView>
            <SignInSheet visible={signingIn} onClose={() => setSigningIn(false)} />
            <Sheet visible={enteringCode} onClose={() => setEnteringCode(false)}>
                <Text variant="heading" align="center" accessibilityRole="header">
                    {t("code.title")}
                </Text>
                <Text variant="small" tone="ash" align="center">
                    {t("code.body")}
                </Text>
                <CodeEntry
                    onSubmit={(code) => {
                        setEnteringCode(false);
                        router.push(`/j/${code}` as Href);
                    }}
                />
            </Sheet>
        </View>
    );
}

/** "By continuing you agree to the Terms and the Privacy Policy.", with two separate links. */
/** A sentence naming the Terms and the Privacy Policy, each a link. */
export function LegalLine({ sentence = t("welcome.legal") }: { sentence?: string }) {
    const links = [
        { label: t("welcome.legalTerms"), url: siteLink("terms") },
        { label: t("welcome.legalPrivacy"), url: siteLink("privacy") },
    ];
    const parts: ({ text: string } | { text: string; url: string })[] = [];
    let rest = sentence;
    for (const link of links) {
        const at = rest.indexOf(link.label);
        if (at < 0) continue;
        if (at > 0) parts.push({ text: rest.slice(0, at) });
        parts.push({ text: link.label, url: link.url });
        rest = rest.slice(at + link.label.length);
    }
    if (rest) parts.push({ text: rest });
    return (
        <View style={{ marginTop: space.l }}>
            <Text variant="caption" tone="ash" align="center">
                {parts.map((part, i) =>
                    "url" in part ? (
                        <RNText
                            key={i}
                            onPress={() => openLink(part.url)}
                            accessibilityRole="link"
                            style={styles.legalLink}
                            suppressHighlighting={false}
                        >
                            {part.text}
                        </RNText>
                    ) : (
                        part.text
                    ),
                )}
            </Text>
        </View>
    );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 30;

/** What to say about a failed sign-in step, from the server's code. */
function signInProblem(step: "start" | "verify", code: string): string {
    if (step === "start" && code === "too-many") return t("signIn.tooMany");
    return problem(code);
}

function SignInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [problemLine, setProblemLine] = useState<string | null>(null);
    const [resent, setResent] = useState(false);
    const [sentAt, setSentAt] = useState(0);
    const [now, setNow] = useState(() => Date.now());
    const start = useAction(api.auth.start);
    const verify = useAction(api.auth.verify);

    const waitSeconds = Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000));
    useEffect(() => {
        if (waitSeconds === 0) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [waitSeconds]);

    const send = async (again: boolean) => {
        const address = (again ? (sentTo ?? email) : email).trim().toLowerCase();
        if (!EMAIL.test(address)) {
            setProblemLine(t("signIn.badEmail"));
            return;
        }
        setProblemLine(null);
        verify.reset();
        const ok = await start.run(address);
        if (ok === undefined) return;
        setSentTo(address);
        setResent(again);
        setCode("");
        setSentAt(Date.now());
        setNow(Date.now());
    };

    const submit = async (value: string) => {
        if (!sentTo || value.length !== 6) return;
        storage.set(EMAIL_SIGN_IN_KEY, "1");
        const session = await verify.run(sentTo, value);
        if (!session) {
            storage.remove(EMAIL_SIGN_IN_KEY);
            setCode("");
            return;
        }
        haptic("success");
        close();
    };

    const close = () => {
        setCode("");
        setSentTo(null);
        setProblemLine(null);
        setResent(false);
        start.reset();
        verify.reset();
        onClose();
    };

    const error =
        problemLine ??
        (start.error
            ? signInProblem("start", start.error.code)
            : verify.error
              ? signInProblem("verify", verify.error.code)
              : null);

    return (
        <Sheet visible={visible} onClose={close}>
            {sentTo === null ? (
                <>
                    <Text variant="heading" align="center" accessibilityRole="header">
                        {t("signIn.title")}
                    </Text>
                    <Text variant="small" tone="ash" align="center">
                        {t("signIn.body")}
                    </Text>
                    <Input
                        value={email}
                        onChangeText={setEmail}
                        placeholder={t("signIn.emailPlaceholder")}
                        autoCapitalize="none"
                        autoComplete="email"
                        keyboardType="email-address"
                        textContentType="emailAddress"
                        returnKeyType="send"
                        autoFocus
                        onSubmitEditing={() => {
                            send(false);
                        }}
                        accessibilityLabel={t("signIn.emailPlaceholder")}
                    />
                    {error ? <Notice>{error}</Notice> : null}
                    <Button
                        label={t("signIn.send")}
                        loading={start.busy}
                        onPress={() => {
                            send(false);
                        }}
                    />
                </>
            ) : (
                <>
                    <Text variant="heading" align="center" accessibilityRole="header">
                        {t("signIn.codeTitle")}
                    </Text>
                    <Text variant="small" tone="ash" align="center">
                        {t("signIn.codeBody", { email: sentTo })}
                    </Text>
                    <Input
                        value={code}
                        onChangeText={(text) => {
                            const digits = text.replace(/\D/g, "").slice(0, 6);
                            setCode(digits);
                            if (digits.length === 6) submit(digits);
                        }}
                        placeholder={t("signIn.codePlaceholder")}
                        keyboardType="number-pad"
                        textContentType="oneTimeCode"
                        autoComplete="one-time-code"
                        autoFocus
                        maxLength={6}
                        style={styles.codeInput}
                        accessibilityLabel={t("signIn.codeLabel")}
                    />
                    {Platform.OS === "ios" ? (
                        <View style={{ alignItems: "center" }}>
                            <TextLink
                                label={t("signIn.openMail")}
                                onPress={() => {
                                    Linking.openURL("message://").catch(() => null);
                                }}
                            />
                        </View>
                    ) : null}
                    {error ? <Notice>{error}</Notice> : null}
                    {resent && !error ? (
                        <Text variant="small" tone="ash" align="center">
                            {t("signIn.resent")}
                        </Text>
                    ) : null}
                    <Button
                        label={t("signIn.verify")}
                        loading={verify.busy}
                        disabled={code.length !== 6}
                        onPress={() => {
                            submit(code);
                        }}
                    />
                    <View style={styles.sheetLinks}>
                        <TextLink
                            label={
                                waitSeconds > 0
                                    ? t("signIn.resendIn", { seconds: waitSeconds })
                                    : t("signIn.resend")
                            }
                            disabled={waitSeconds > 0 || start.busy}
                            onPress={() => {
                                send(true);
                            }}
                        />
                        <TextLink
                            label={t("signIn.changeEmail")}
                            onPress={() => {
                                setSentTo(null);
                                setCode("");
                                setProblemLine(null);
                                start.reset();
                                verify.reset();
                            }}
                        />
                    </View>
                </>
            )}
        </Sheet>
    );
}

interface TextLinkProps {
    label: string;
    onPress: () => void;
    disabled?: boolean;
}

function TextLink({ label, onPress, disabled = false }: TextLinkProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            hitSlop={8}
        >
            <Text variant="small" tone={disabled ? "faint" : "ash"} weight="medium">
                {label}
            </Text>
        </Pressable>
    );
}

/** "What should guests call you?", after a first sign-in and from Settings. */
function NameSheet({
    visible,
    initial,
    onClose,
}: {
    visible: boolean;
    initial: string;
    onClose: () => void;
}) {
    const [name, setName] = useState(initial);
    const [opened, setOpened] = useState(false);
    const rename = useAction(api.me.rename);
    // Start from the saved name each time the sheet opens.
    if (visible !== opened) {
        setOpened(visible);
        if (visible) setName(initial);
    }
    const save = async () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (trimmed === initial) {
            onClose();
            return;
        }
        const host = await rename.run(trimmed);
        if (!host) return;
        haptic("success");
        onClose();
    };
    return (
        <Sheet
            visible={visible}
            onClose={() => {
                rename.reset();
                onClose();
            }}
        >
            <Text variant="heading" align="center" accessibilityRole="header">
                {t("signIn.nameTitle")}
            </Text>
            <Text variant="small" tone="ash" align="center">
                {t("signIn.nameBody")}
            </Text>
            <Input
                value={name}
                onChangeText={setName}
                placeholder={t("join.namePlaceholder")}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
                returnKeyType="done"
                maxLength={40}
                autoFocus
                onSubmitEditing={() => {
                    save();
                }}
                accessibilityLabel={t("settings.name")}
            />
            {rename.error ? <Notice>{problem(rename.error.code)}</Notice> : null}
            <Button
                label={t("signIn.nameSave")}
                loading={rename.busy}
                disabled={name.trim() === ""}
                onPress={() => {
                    save();
                }}
            />
        </Sheet>
    );
}

// Signed in

type Group = "live" | "upcoming" | "waiting" | "drafts" | "revealed" | "past";

const GROUPS: readonly Group[] = ["live", "upcoming", "waiting", "drafts", "revealed", "past"];

/** Where an event sits in the host's list, from its state as the server's clock has it now. */
function groupOf(event: Event, now: Date): Group {
    const state = dueState(
        event.state,
        event.settings,
        event.revealedAt ? new Date(event.revealedAt) : null,
        now,
    );
    switch (state) {
        case "draft":
            return "drafts";
        case "live":
            return shootingPhase({ state, ...event.settings }, now) === "before"
                ? "upcoming"
                : "live";
        case "ended":
            return "waiting";
        case "revealed":
            return "revealed";
        case "archived":
            return "past";
    }
}

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

/** Soonest first for what's coming, most recent first for what's done. */
function sortKey(group: Group, event: Event): number {
    switch (group) {
        case "live":
            return time(event.settings.endsAt);
        case "upcoming":
            return time(event.settings.startsAt);
        case "waiting":
            return time(event.revealsAt);
        case "drafts":
            return -time(event.createdAt);
        case "revealed":
        case "past":
            return -time(event.revealedAt ?? event.revealsAt);
    }
}

function grouped(list: readonly Event[], now: Date): { group: Group; events: Event[] }[] {
    const byGroup = new Map<Group, Event[]>();
    for (const event of list) {
        const group = groupOf(event, now);
        byGroup.set(group, [...(byGroup.get(group) ?? []), event]);
    }
    return GROUPS.flatMap((group) => {
        const events = byGroup.get(group);
        if (!events) return [];
        events.sort((a, b) => sortKey(group, a) - sortKey(group, b));
        return [{ group, events }];
    });
}

/** The one line under a card's title, in this device's time. */
function cardLine(event: Event, group: Group, now: Date): string {
    switch (group) {
        case "live":
            return t("home.line.live", {
                left: formatDuration(time(event.settings.endsAt) - now.getTime()),
                moments: event.photoCount,
            });
        case "upcoming":
            return t("home.line.upcoming", {
                when: formatWhen(now, new Date(event.settings.startsAt)),
            });
        case "waiting":
            return t("home.line.waiting", {
                day: formatDay(new Date(event.settings.startsAt), deviceZone()),
                reveal: revealLabel(now, new Date(event.revealsAt)),
            });
        case "drafts":
            return t("home.draft");
        case "revealed":
        case "past":
            return t("home.line.revealed", {
                photos: event.photoCount,
                date: dayLabel(new Date(event.revealedAt ?? event.revealsAt), now),
            });
    }
}

function chipLabel(event: Event, group: Group): string {
    if (group === "upcoming") return t("home.group.upcoming");
    if (group === "waiting") return stateLabel("ended");
    if (group === "past") return stateLabel("archived");
    if (group === "drafts") return stateLabel("draft");
    if (group === "revealed") return stateLabel("revealed");
    return stateLabel(event.state === "live" ? "live" : "ended");
}

function Events({ session }: { session: Session }) {
    const router = useRouter();
    const events = useLoad(eventsKey(session.host.id), api.events.list);
    const list = events.data;
    const [pulling, setPulling] = useState(false);
    const [inviting, setInviting] = useState<Event | null>(null);
    // A first sign-in asks for the name guests see. Demo and returning hosts aren't asked.
    const [naming, setNaming] = useState(
        () =>
            storage.getString(EMAIL_SIGN_IN_KEY) === "1" &&
            Date.now() - Date.parse(session.host.createdAt) < NEW_ACCOUNT_MS,
    );
    // The sign-in sheet is still closing as this list appears, and iOS won't present one sheet
    // while another goes, so the name sheet waits until it has gone.
    const [settled, setSettled] = useState(false);
    useEffect(() => {
        storage.remove(EMAIL_SIGN_IN_KEY);
        const timer = setTimeout(() => setSettled(true), SHEET_GONE_MS);
        return () => clearTimeout(timer);
    }, []);
    const still = useReduceMotion();

    if (pulling && !events.loading) setPulling(false);

    const now = serverNow();
    const groups = list ? grouped(list, now) : [];

    const open = (event: Event) =>
        router.push(
            event.state === "draft"
                ? { pathname: "/new", params: { event: event.id } }
                : (`/e/${event.code}` as Href),
        );

    const remove = (event: Event) => {
        const draft = event.state === "draft";
        confirm(
            draft
                ? t("create.deleteDraftTitle")
                : t("manage.deleteTitle", { title: event.settings.title }),
            draft ? t("create.deleteDraftBody") : t("manage.deleteBody"),
            draft ? t("create.deleteDraft") : t("manage.delete"),
            () => {
                api.events
                    .delete(event.id, event.code)
                    .then(() => {
                        invalidate("events:");
                        showToast(t("home.deleted", { title: event.settings.title }));
                    })
                    .catch((error: unknown) => showToast(problem(asApiError(error).code)));
            },
        );
    };

    const actions = (event: Event): { label: string; run: () => void; destructive?: boolean }[] => {
        const del = { label: t("home.menu.delete"), run: () => remove(event), destructive: true };
        if (event.state === "draft") return [del];
        const url = joinLink(event.code);
        const title = event.settings.title;
        return [
            { label: t("home.menu.showCode"), run: () => setInviting(event) },
            {
                label: t("home.menu.shareLink"),
                run: () => {
                    shareLink(
                        title,
                        url,
                        t("create.invite.shareMessage", { title, url }),
                        t("invite.shareText", { title }),
                    ).catch(() => null);
                },
            },
            {
                label: t("home.menu.manage"),
                run: () => router.push(`/e/${event.code}?manage=1` as Href),
            },
            del,
        ];
    };

    const showMenu = (event: Event) => {
        const items = actions(event);
        haptic("medium");
        if (Platform.OS === "ios") {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    title: event.settings.title,
                    options: [...items.map((i) => i.label), t("common.cancel")],
                    cancelButtonIndex: items.length,
                    destructiveButtonIndex: items.findIndex((i) => i.destructive),
                    userInterfaceStyle: "dark",
                },
                (index) => items[index]?.run(),
            );
            return;
        }
        Alert.alert(event.settings.title, undefined, [
            ...items.map((i) => ({
                text: i.label,
                onPress: i.run,
                ...(i.destructive ? { style: "destructive" as const } : {}),
            })),
            { text: t("common.cancel"), style: "cancel" as const },
        ]);
    };

    return (
        <Animated.View style={styles.fill} {...(still ? {} : { entering: FadeIn.duration(200) })}>
            <Screen
                padded={false}
                footer={
                    list && list.length > 0 ? (
                        <Button
                            label={t("home.new")}
                            icon={icons.plus}
                            onPress={() => router.push("/new")}
                        />
                    ) : null
                }
            >
                <ScrollView
                    style={styles.fill}
                    contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 }}
                    refreshControl={
                        <RefreshControl
                            refreshing={pulling}
                            onRefresh={() => {
                                setPulling(true);
                                events.reload();
                            }}
                            tintColor={color.ash}
                        />
                    }
                >
                    <Header onSettings={() => router.push("/settings")} />
                    {list && events.error ? (
                        <View style={{ paddingHorizontal: gutter, marginBottom: space.m }}>
                            <Notice>{t("home.refreshFailed")}</Notice>
                        </View>
                    ) : null}
                    {list === undefined ? (
                        events.error ? (
                            <View style={styles.empty}>
                                <Notice>{t("home.loadFailed")}</Notice>
                                <Button
                                    label={t("common.retry")}
                                    variant="dark"
                                    onPress={events.reload}
                                />
                            </View>
                        ) : (
                            <Placeholders />
                        )
                    ) : list.length === 0 ? (
                        <EmptyState onCreate={() => router.push("/new")} />
                    ) : (
                        <View style={{ gap: 12, paddingHorizontal: 12 }}>
                            <Text
                                variant="title"
                                accessibilityRole="header"
                                style={{ paddingHorizontal: 10 }}
                            >
                                {t("home.title")}
                            </Text>
                            {groups.map(({ group, events: inGroup }) => (
                                <View key={group} style={{ gap: 12 }}>
                                    <Text
                                        variant="small"
                                        tone="ash"
                                        weight="medium"
                                        accessibilityRole="header"
                                        style={styles.groupLabel}
                                    >
                                        {t(`home.group.${group}`)}
                                    </Text>
                                    {inGroup.map((event) => (
                                        <Animated.View
                                            key={event.id}
                                            {...(still ? {} : { entering: FadeIn.duration(150) })}
                                        >
                                            <EventCard
                                                event={event}
                                                group={group}
                                                now={now}
                                                onPress={() => open(event)}
                                                onLongPress={() => showMenu(event)}
                                                actions={actions(event)}
                                            />
                                        </Animated.View>
                                    ))}
                                </View>
                            ))}
                        </View>
                    )}
                    <View style={{ paddingHorizontal: 12, marginTop: space.xl }}>
                        <JoinedEvents onOpen={(code) => router.push(`/e/${code}` as Href)} />
                    </View>
                </ScrollView>
            </Screen>
            {inviting ? (
                <InviteSheet
                    visible
                    onClose={() => setInviting(null)}
                    code={inviting.code}
                    title={inviting.settings.title}
                />
            ) : null}
            <NameSheet
                visible={naming && settled}
                initial={session.host.name}
                onClose={() => setNaming(false)}
            />
        </Animated.View>
    );
}

function Header({ onSettings }: { onSettings: () => void }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
            <Wordmark size={29} />
            <IconButton
                icon={icons.settings}
                onPress={onSettings}
                accessibilityLabel={t("home.settings")}
            />
        </View>
    );
}

/** Two card-shaped Surface blocks while the list loads for the first time. */
function Placeholders() {
    return (
        <View style={{ gap: 12, paddingHorizontal: 12 }} aria-hidden>
            <View style={[styles.card, styles.placeholder]} />
            <View style={[styles.card, styles.placeholder]} />
        </View>
    );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
    return (
        <View style={styles.empty}>
            <Mark size={56} />
            <Text variant="title" align="center" style={{ marginTop: 24 }}>
                {t("home.empty.title")}
            </Text>
            <Text variant="small" tone="ash" align="center" style={{ marginTop: 10 }}>
                {t("home.empty.body")}
            </Text>
            <Button
                label={t("home.empty.cta")}
                icon={icons.plus}
                onPress={onCreate}
                style={{ alignSelf: "stretch", marginTop: 28 }}
            />
        </View>
    );
}

interface EventCardProps {
    event: Event;
    group: Group;
    now: Date;
    onPress: () => void;
    onLongPress: () => void;
    /** The long-press menu, offered to screen readers as actions. */
    actions: readonly { label: string; run: () => void }[];
}

function EventCard({ event, group, now, onPress, onLongPress, actions }: EventCardProps) {
    const live = group === "live";
    const line = cardLine(event, group, now);
    const chip = chipLabel(event, group);
    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityLabel={`${event.settings.title}, ${chip}. ${line}`}
            accessibilityActions={actions.map((a) => ({ name: a.label, label: a.label }))}
            onAccessibilityAction={(e) => {
                actions.find((a) => a.label === e.nativeEvent.actionName)?.run();
            }}
            style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}
        >
            {event.coverUrl ? (
                <Image
                    source={event.coverUrl}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={200}
                />
            ) : (
                <View style={[StyleSheet.absoluteFill, styles.cardBlank]}>
                    <Icon
                        icon={occasionIcons[event.settings.occasion]}
                        size={56}
                        weight="duotone"
                        color={color.faint}
                    />
                </View>
            )}
            <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                <Defs>
                    <LinearGradient id="card" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset={0.25} stopColor={color.night} stopOpacity={0} />
                        <Stop offset={1} stopColor={color.night} stopOpacity={0.9} />
                    </LinearGradient>
                </Defs>
                <Rect width="100%" height="100%" fill="url(#card)" />
            </Svg>
            <View style={styles.chip}>
                {live ? <View style={styles.liveDot} /> : null}
                <Text variant="caption" weight="semibold">
                    {chip}
                </Text>
            </View>
            <View style={styles.cardText}>
                <Text variant="heading" numberOfLines={2}>
                    {event.settings.title}
                </Text>
                <Text variant="small" tone="soft" style={{ marginTop: 4 }} numberOfLines={2}>
                    {line}
                </Text>
            </View>
        </Pressable>
    );
}

// Settings

/** Reports how many of one event's photos are still waiting to upload. */
function PendingWatch({
    code,
    onCount,
}: {
    code: string;
    onCount: (code: string, pending: number) => void;
}) {
    const { pending } = useShots(code);
    useEffect(() => {
        onCount(code, pending);
    }, [code, pending, onCount]);
    return null;
}

/** Whether LingerCam may show notifications, read again whenever Settings comes into view. */
function useNotificationsAllowed(): boolean | null {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const read = useCallback(() => {
        if (Platform.OS === "web") return;
        Notifications.getPermissionsAsync()
            .then((p) => setAllowed(p.granted))
            .catch(() => null);
    }, []);
    useFocusEffect(read);
    useOnForeground(read);
    return allowed;
}

export function SettingsScreen() {
    if (Platform.OS === "web") return <HostAppNote />;
    return <Settings />;
}

function Settings() {
    const router = useRouter();
    const session = useSession();
    const remove = useAction(api.me.delete);
    const signOut = useAction(api.auth.signOut);
    const [naming, setNaming] = useState(false);
    const [pendingByCode, setPendingByCode] = useState<Record<string, number>>({});
    const notifications = useNotificationsAllowed();
    const events = useLoad(session ? eventsKey(session.host.id) : null, api.events.list);
    const list = events.data ?? (session ? cached<Event[]>(eventsKey(session.host.id)) : undefined);
    const codes = (list ?? []).map((e) => e.code);

    const onCount = useCallback((code: string, pending: number) => {
        setPendingByCode((prev) => (prev[code] === pending ? prev : { ...prev, [code]: pending }));
    }, []);

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
    };

    const confirmDelete = () => {
        confirm(
            t("settings.deleteTitle"),
            !list
                ? t("settings.deleteBody")
                : list.length === 0
                  ? t("settings.deleteBodyEmpty")
                  : t("settings.deleteBodyEvents", { count: list.length }),
            t("settings.deleteConfirm"),
            () => {
                remove.run().then((done) => {
                    if (done !== undefined) leave();
                });
            },
        );
    };

    const runSignOut = async () => {
        // This device stops reminding the host about their own events.
        for (const code of codes) {
            storage.remove(`reminder:${code}`);
            await Notifications.cancelScheduledNotificationAsync(`reveal-${code}`).catch(
                () => null,
            );
        }
        await signOut.run();
        leave();
    };

    const askSignOut = () => {
        const waiting = codes.reduce((sum, code) => sum + (pendingByCode[code] ?? 0), 0);
        const buying = session ? hasPendingClaims(session.host.id) : false;
        const run = () => {
            runSignOut().catch(() => null);
        };
        if (waiting > 0) {
            confirm(
                t("settings.signOutTitle"),
                t("settings.signOutWaiting", { count: waiting }),
                t("settings.signOut"),
                run,
            );
        } else if (buying) {
            confirm(
                t("settings.signOutTitle"),
                t("settings.signOutPurchase"),
                t("settings.signOut"),
                run,
            );
        } else {
            run();
        }
    };

    const openNotifications = async () => {
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted && permission.canAskAgain && permission.status === "undetermined") {
            await Notifications.requestPermissionsAsync();
            return;
        }
        await Linking.openSettings();
    };

    return (
        // On iOS settings is a sheet below the status bar, so it needs no safe-area top.
        <Screen scroll {...(Platform.OS === "ios" ? { style: { paddingTop: 24 } } : {})}>
            {codes.map((code) => (
                <PendingWatch key={code} code={code} onCount={onCount} />
            ))}
            <View style={styles.settingsTop}>
                <Text variant="title" accessibilityRole="header">
                    {t("settings.title")}
                </Text>
                <IconButton
                    icon={icons.close}
                    onPress={leave}
                    accessibilityLabel={t("common.close")}
                />
            </View>
            {session ? (
                <Text variant="small" tone="ash" style={{ marginTop: 8 }}>
                    {t("settings.signedIn", { email: session.host.email })}
                </Text>
            ) : null}

            {session ? (
                <View style={styles.groupGap}>
                    <RowGroup>
                        <Row
                            label={t("settings.name")}
                            value={session.host.name}
                            onPress={() => setNaming(true)}
                        />
                        <Row
                            label={t("settings.notifications")}
                            {...(notifications === null
                                ? {}
                                : {
                                      value: notifications
                                          ? t("settings.notificationsOn")
                                          : t("settings.notificationsOff"),
                                  })}
                            onPress={() => {
                                openNotifications().catch(() => null);
                            }}
                        />
                    </RowGroup>
                </View>
            ) : null}

            <View style={styles.groupGap}>
                <RowGroup>
                    <Row
                        label={t("settings.support")}
                        onPress={() => openLink(siteLink("support"))}
                    />
                    <Row
                        label={t("settings.privacy")}
                        onPress={() => openLink(siteLink("privacy"))}
                    />
                    <Row label={t("settings.terms")} onPress={() => openLink(siteLink("terms"))} />
                </RowGroup>
            </View>

            {session ? (
                <View style={styles.groupGap}>
                    <RowGroup>
                        <Row
                            label={t("settings.signOut")}
                            icon={icons.signOut}
                            disabled={signOut.busy}
                            onPress={askSignOut}
                        />
                        <Row
                            label={t("settings.delete")}
                            destructive
                            disabled={remove.busy}
                            onPress={confirmDelete}
                        />
                    </RowGroup>
                </View>
            ) : null}
            {remove.error ? <Notice>{t("settings.deleteFailed")}</Notice> : null}

            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="ash" align="center" style={{ marginTop: 32 }}>
                {t("settings.version", { version: Constants.expoConfig?.version ?? "" })}
            </Text>
            {session ? (
                <NameSheet
                    visible={naming}
                    initial={session.host.name}
                    onClose={() => setNaming(false)}
                />
            ) : null}
        </Screen>
    );
}

// The web build serves guests. Its root is the guest home; host routes point to the apps.

const APP_STORE_URL = process.env.EXPO_PUBLIC_APP_STORE_URL || `${SITE_URL}/support/#get-the-app`;
const PLAY_STORE_URL = process.env.EXPO_PUBLIC_PLAY_STORE_URL || `${SITE_URL}/support/#get-the-app`;

function GuestHome() {
    const router = useRouter();
    return (
        <Screen scroll>
            <View style={styles.note}>
                <Wordmark size={34} />
                <View style={{ alignSelf: "stretch", marginTop: space.xxl }}>
                    <JoinedEvents onOpen={(code) => router.push(`/e/${code}` as Href)} />
                </View>
                <Text
                    variant="title"
                    align="center"
                    accessibilityRole="header"
                    style={{ marginTop: space.xxl }}
                >
                    {t("code.title")}
                </Text>
                <Text variant="small" tone="ash" align="center" style={{ marginTop: space.s }}>
                    {t("code.body")}
                </Text>
                <View style={{ alignSelf: "stretch", marginTop: space.l }}>
                    <CodeEntry onSubmit={(code) => router.push(`/j/${code}` as Href)} />
                </View>
                <Text variant="small" tone="ash" align="center" style={{ marginTop: space.xxl }}>
                    {t("web.homeBody")}
                </Text>
                <Pressable
                    onPress={() => openLink(SITE_URL)}
                    accessibilityRole="link"
                    hitSlop={8}
                    style={{ marginTop: space.l }}
                >
                    <Text variant="small" weight="medium">
                        {t("web.siteLink")}
                    </Text>
                </Pressable>
            </View>
        </Screen>
    );
}

export function HostAppNote() {
    return (
        <Screen>
            <View style={[styles.note, { flex: 1, justifyContent: "center" }]}>
                <Wordmark size={34} />
                <Text variant="title" align="center" style={{ marginTop: 32 }}>
                    {t("web.hostTitle")}
                </Text>
                <Text variant="small" tone="ash" align="center" style={{ marginTop: 12 }}>
                    {t("web.hostBody")}
                </Text>
                <View style={{ gap: 10, marginTop: 28, alignSelf: "stretch" }}>
                    <Button label={t("web.appStore")} onPress={() => openLink(APP_STORE_URL)} />
                    <Button
                        label={t("web.playStore")}
                        variant="dark"
                        onPress={() => openLink(PLAY_STORE_URL)}
                    />
                </View>
            </View>
        </Screen>
    );
}

function openLink(url: string): void {
    if (Platform.OS === "web") {
        Linking.openURL(url).catch(() => null);
        return;
    }
    WebBrowser.openBrowserAsync(url, { controlsColor: color.paper }).catch(() => null);
}

const styles = StyleSheet.create({
    fill: { flex: 1, backgroundColor: color.night },
    fill0: { flex: 1 },
    welcomePhoto: { position: "absolute", left: 0, right: 0, top: 0, height: "62%" },
    welcomeBody: { flexGrow: 1, justifyContent: "flex-end", paddingHorizontal: gutter },
    welcomeText: { paddingTop: space.l },
    welcomeFade: { position: "absolute", left: -gutter, right: -gutter, top: -160, height: 160 },
    welcomeShade: {
        position: "absolute",
        left: -gutter,
        right: -gutter,
        top: 0,
        bottom: 0,
        backgroundColor: WELCOME_SHADE,
    },
    legalLink: { color: color.paper, textDecorationLine: "underline" },
    codeInput: { textAlign: "center", fontSize: 28, letterSpacing: 8 },
    sheetLinks: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: gutter,
        paddingBottom: 18,
    },
    groupLabel: { paddingHorizontal: 10, marginTop: space.s },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: gutter },
    card: {
        height: 240,
        borderRadius: radius.card,
        overflow: "hidden",
        backgroundColor: color.surface,
        justifyContent: "flex-end",
    },
    placeholder: { opacity: 0.6 },
    cardBlank: { alignItems: "center", justifyContent: "center", paddingBottom: 60 },
    cardText: { padding: 18 },
    chip: {
        position: "absolute",
        top: 14,
        left: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 10,
        backgroundColor: color.glass,
    },
    liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.candle },
    settingsTop: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    groupGap: { marginTop: 26 },
    note: {
        alignItems: "center",
        maxWidth: 440,
        width: "100%",
        alignSelf: "center",
    },
});
