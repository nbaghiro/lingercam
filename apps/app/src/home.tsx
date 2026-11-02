import type { Event } from "@linger/core/events";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import {
    Alert,
    Linking,
    Platform,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { SITE_URL, api, siteLink, useAction, useLoad, useSession } from "@/api";
import { formatDay, revealLabel, stateLabel, t } from "@/copy";
import {
    Button,
    Icon,
    IconButton,
    Input,
    Mark,
    Notice,
    Screen,
    Sheet,
    Text,
    Wordmark,
    color,
    gutter,
    icons,
    occasionIcons,
} from "@/ui";

const WELCOME_PHOTO = require("../assets/demo/w-hero.jpg");

export function HomeScreen() {
    const session = useSession();
    if (Platform.OS === "web") return <HostAppNote />;
    if (!session) return <Welcome />;
    return <Events />;
}

// Signed out

function Welcome() {
    const insets = useSafeAreaInsets();
    const [signingIn, setSigningIn] = useState(false);
    const demo = useAction(api.auth.demo);
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
            <View
                style={[
                    styles.welcomeBody,
                    { paddingBottom: Math.max(insets.bottom, 12) + 10, paddingTop: insets.top },
                ]}
            >
                <Wordmark size={34} />
                <Text variant="display" style={{ marginTop: 22 }}>
                    {t("welcome.title")}
                </Text>
                <Text variant="small" tone="ash" style={{ marginTop: 12, marginBottom: 28 }}>
                    {t("welcome.body")}
                </Text>
                <View style={{ gap: 10 }}>
                    <Button
                        label={t("welcome.email")}
                        icon={icons.email}
                        onPress={() => setSigningIn(true)}
                    />
                    {__DEV__ ? (
                        <Button
                            label={t("welcome.demo")}
                            variant="dark"
                            loading={demo.busy}
                            onPress={() => {
                                demo.run();
                            }}
                        />
                    ) : null}
                </View>
                {demo.error ? <Notice>{errorMessage(demo.error.code)}</Notice> : null}
                <Pressable
                    onPress={() => openLink(siteLink("terms"))}
                    accessibilityRole="link"
                    style={{ marginTop: 16 }}
                >
                    <Text variant="caption" tone="faint" align="center">
                        {t("welcome.legal")}
                    </Text>
                </Pressable>
            </View>
            <SignInSheet visible={signingIn} onClose={() => setSigningIn(false)} />
        </View>
    );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SignInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [sentTo, setSentTo] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [resent, setResent] = useState(false);
    const start = useAction(api.auth.start);
    const verify = useAction(api.auth.verify);

    const send = async (again: boolean) => {
        const address = (again ? (sentTo ?? email) : email).trim().toLowerCase();
        if (!EMAIL.test(address)) {
            setProblem(t("signIn.badEmail"));
            return;
        }
        setProblem(null);
        const ok = await start.run(address);
        if (ok === undefined) return;
        setSentTo(address);
        setResent(again);
    };

    const submit = async (value: string) => {
        if (!sentTo || value.length !== 6) return;
        const session = await verify.run(sentTo, value);
        if (session) close();
    };

    const close = () => {
        setCode("");
        setSentTo(null);
        setProblem(null);
        setResent(false);
        start.reset();
        verify.reset();
        onClose();
    };

    const error = problem ?? (start.error ?? verify.error)?.message ?? null;

    return (
        <Sheet visible={visible} onClose={close}>
            {sentTo === null ? (
                <>
                    <Text variant="heading" align="center">
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
                    <Text variant="heading" align="center">
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
                        accessibilityLabel={t("signIn.codeTitle")}
                    />
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
                            label={t("signIn.resend")}
                            onPress={() => {
                                send(true);
                            }}
                        />
                        <TextLink
                            label={t("signIn.changeEmail")}
                            onPress={() => {
                                setSentTo(null);
                                setCode("");
                                verify.reset();
                            }}
                        />
                    </View>
                </>
            )}
        </Sheet>
    );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
            <Text variant="small" tone="ash" weight="medium">
                {label}
            </Text>
        </Pressable>
    );
}

// Signed in

function Events() {
    const router = useRouter();
    const session = useSession();
    const [visits, setVisits] = useState(0);
    useFocusEffect(useCallback(() => setVisits((n) => n + 1), []));
    const key = session && visits > 0 ? `events:${session.host.id}:${visits}` : null;
    const events = useLoad(key, api.events.list);
    const list = events.data;

    return (
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
                        refreshing={events.loading && list !== undefined}
                        onRefresh={events.reload}
                        tintColor={color.ash}
                    />
                }
            >
                <Header onSettings={() => router.push("/settings")} />
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
                    ) : null
                ) : list.length === 0 ? (
                    <EmptyState onCreate={() => router.push("/new")} />
                ) : (
                    <View style={{ gap: 12, paddingHorizontal: 12 }}>
                        <Text variant="title" style={{ paddingHorizontal: 10, marginBottom: 6 }}>
                            {t("home.title")}
                        </Text>
                        {list.map((event) => (
                            <EventCard
                                key={event.id}
                                event={event}
                                onPress={() =>
                                    router.push(
                                        event.state === "draft"
                                            ? { pathname: "/new", params: { event: event.id } }
                                            : (`/e/${event.code}` as Href),
                                    )
                                }
                            />
                        ))}
                    </View>
                )}
            </ScrollView>
        </Screen>
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

function cardLine(event: Event, now: Date): string {
    const day = formatDay(new Date(event.settings.startsAt), event.settings.timeZone);
    if (event.state === "draft") return t("home.draft");
    if (event.state === "live" || event.state === "ended") {
        return `${day} · ${revealLabel(now, new Date(event.revealsAt))}`;
    }
    return day;
}

function EventCard({ event, onPress }: { event: Event; onPress: () => void }) {
    const now = new Date();
    const live = event.state === "live";
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`${event.settings.title}, ${stateLabel(event.state)}. ${cardLine(event, now)}`}
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
                    {stateLabel(event.state)}
                </Text>
            </View>
            <View style={styles.cardText}>
                <Text variant="heading" numberOfLines={2}>
                    {event.settings.title}
                </Text>
                <Text variant="small" tone="soft" style={{ marginTop: 4 }} numberOfLines={1}>
                    {cardLine(event, now)}
                </Text>
            </View>
        </Pressable>
    );
}

// Settings

export function SettingsScreen() {
    const router = useRouter();
    const session = useSession();
    const remove = useAction(api.me.delete);
    const signOut = useAction(api.auth.signOut);

    if (Platform.OS === "web") return <HostAppNote />;

    const leave = () => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
    };

    const confirmDelete = () => {
        Alert.alert(t("settings.deleteTitle"), t("settings.deleteBody"), [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: t("settings.deleteConfirm"),
                style: "destructive",
                onPress: () => {
                    remove.run().then((done) => {
                        if (done !== undefined) leave();
                    });
                },
            },
        ]);
    };

    return (
        // On iOS settings is a sheet below the status bar, so it needs no safe-area top.
        <Screen scroll {...(Platform.OS === "ios" ? { style: { paddingTop: 24 } } : {})}>
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

            <View style={styles.group}>
                <SettingsRow
                    label={t("settings.support")}
                    onPress={() => openLink(siteLink("support"))}
                />
                <SettingsRow
                    label={t("settings.privacy")}
                    onPress={() => openLink(siteLink("privacy"))}
                />
                <SettingsRow
                    label={t("settings.terms")}
                    onPress={() => openLink(siteLink("terms"))}
                />
            </View>

            {session ? (
                <View style={styles.group}>
                    <SettingsRow
                        label={t("settings.signOut")}
                        icon={icons.signOut}
                        busy={signOut.busy}
                        onPress={() => {
                            signOut.run().then(leave);
                        }}
                    />
                    <SettingsRow
                        label={t("settings.delete")}
                        icon={icons.trash}
                        tone="candle"
                        busy={remove.busy}
                        onPress={confirmDelete}
                    />
                </View>
            ) : null}
            {remove.error ? <Notice>{t("settings.deleteFailed")}</Notice> : null}

            <View style={{ flex: 1 }} />
            <Text variant="caption" tone="faint" align="center" style={{ marginTop: 32 }}>
                {t("settings.version", { version: Constants.expoConfig?.version ?? "" })}
            </Text>
        </Screen>
    );
}

interface SettingsRowProps {
    label: string;
    onPress: () => void;
    icon?: (typeof icons)[keyof typeof icons];
    tone?: "paper" | "candle";
    busy?: boolean;
}

function SettingsRow({ label, onPress, icon, tone = "paper", busy = false }: SettingsRowProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ busy }}
            style={({ pressed }) => [styles.settingsRow, { opacity: pressed || busy ? 0.6 : 1 }]}
        >
            <Text weight="medium" tone={tone} style={{ flex: 1 }}>
                {label}
            </Text>
            <Icon
                icon={icon ?? icons.chevron}
                size={18}
                color={tone === "candle" ? color.candle : color.ash}
            />
        </Pressable>
    );
}

// The web build serves guests. Hosts use the iPhone or Android app.

export function HostAppNote() {
    return (
        <Screen>
            <View style={styles.note}>
                <Wordmark size={34} />
                <Text variant="title" align="center" style={{ marginTop: 32 }}>
                    {t("web.hostTitle")}
                </Text>
                <Text variant="small" tone="ash" align="center" style={{ marginTop: 12 }}>
                    {t("web.hostBody")}
                </Text>
                <View style={{ gap: 10, marginTop: 28, alignSelf: "stretch" }}>
                    <Button label={t("web.appStore")} onPress={() => openLink(SITE_URL)} />
                    <Button
                        label={t("web.playStore")}
                        variant="dark"
                        onPress={() => openLink(SITE_URL)}
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

function errorMessage(code: string): string {
    return code === "network" ? t("common.offline") : t("common.error");
}

const styles = StyleSheet.create({
    fill: { flex: 1, backgroundColor: color.night },
    welcomePhoto: { position: "absolute", left: 0, right: 0, top: 0, height: "62%" },
    welcomeBody: { flex: 1, justifyContent: "flex-end", paddingHorizontal: gutter },
    codeInput: { textAlign: "center", fontSize: 28, letterSpacing: 8 },
    sheetLinks: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: gutter,
        paddingBottom: 18,
    },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: gutter },
    card: {
        height: 240,
        borderRadius: 22,
        overflow: "hidden",
        backgroundColor: color.surface,
        justifyContent: "flex-end",
    },
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
    group: {
        marginTop: 26,
        borderRadius: 18,
        backgroundColor: color.surface,
        overflow: "hidden",
    },
    settingsRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 17,
        paddingHorizontal: 18,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: color.line,
    },
    note: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        maxWidth: 440,
        alignSelf: "center",
    },
});
