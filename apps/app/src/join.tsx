import { NAME_MAX } from "@linger/core/events";
import { canShoot } from "@linger/core/shots";
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, storage, useAction, useLoad, useSession, type EventSummary } from "@/api";
import { useCameraAccess } from "@/camera";
import { revealWhen, t } from "@/copy";
import { useCode } from "@/event";
import { Button, Field, Icon, Mark, Notice, Text, color, icons } from "@/ui";
import { setShotsLeft } from "@/uploads";

// The join sheet over the event's blurred cover, as an App Clip would show it: the invite, then
// the guest's name, then the camera permission. The browser join page is the same screen.

const NAME_KEY = "guestName";

type Step = "invite" | "name" | "camera";

function rules(event: EventSummary, now: Date): string {
    const when = revealWhen(now, new Date(event.revealsAt), event.timeZone);
    if (event.state === "revealed" || event.state === "archived") return t("join.rulesRevealed");
    if (event.state === "ended" || now.getTime() >= Date.parse(event.endsAt)) {
        return t("join.rulesEnded", { when });
    }
    if (event.shotsPerGuest === null) return t("join.rulesUnlimited", { when });
    if (event.revealMode === "right-away") {
        return t("join.rulesRightAway", { shots: event.shotsPerGuest });
    }
    return t("join.rules", { shots: event.shotsPerGuest, when });
}

function joinProblem(code: string | undefined): string {
    switch (code) {
        case "event-full":
            return t("join.full");
        case "not-open":
            return t("join.notOpen");
        case "not-found":
            return t("join.notFound");
        case "network":
            return t("common.offline");
        default:
            return t("common.error");
    }
}

export function JoinScreen() {
    const code = useCode();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const session = useSession();
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const me = useLoad(`me:${code}`, () => api.guest.me(code));
    const access = useCameraAccess();
    const join = useAction((name: string) => api.guest.join(code, name));
    const [step, setStep] = useState<Step>("invite");
    const [name, setName] = useState(() => storage.getString(NAME_KEY) ?? session?.host.name ?? "");
    const [asking, setAsking] = useState(false);
    const [now] = useState(() => new Date());

    const event = summary.data;
    const joined = me.data !== undefined;
    const shooting = event !== undefined && canShoot(event, now);
    const draft = event?.state === "draft";

    // The event sits under the camera, so leaving the camera lands on the event.
    const go = () => {
        router.replace(`/e/${code}` as Href);
        if (shooting) router.push(`/e/${code}/camera` as Href);
    };

    const next = () => {
        if (!joined) setStep("name");
        else if (shooting && access.granted !== true) setStep("camera");
        else go();
    };

    const submitName = async () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const result = await join.run(trimmed);
        if (!result) return;
        storage.set(NAME_KEY, trimmed);
        setShotsLeft(code, result.shotsLeft);
        if (shooting && access.granted !== true) setStep("camera");
        else go();
    };

    const allow = async () => {
        setAsking(true);
        const granted = await access.request().catch(() => false);
        setAsking(false);
        if (granted) go();
    };

    let content: ReactNode;
    if (!event) {
        content = summary.error ? (
            <>
                <Notice>{joinProblem(summary.error.code)}</Notice>
                <Button label={t("common.retry")} variant="dark" onPress={summary.reload} />
            </>
        ) : (
            <ActivityIndicator color={color.ash} style={{ marginVertical: 60 }} />
        );
    } else if (step === "invite") {
        const full = event.full && !joined && !me.loading;
        content = (
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
                        {t("join.by")}
                    </Text>
                </View>
                <Text variant="heading" align="center" accessibilityRole="header">
                    {t("join.invited", { title: event.title })}
                </Text>
                <Text variant="small" tone="ash" align="center">
                    {draft ? t("join.notOpen") : rules(event, now)}
                </Text>
                {full ? <Notice>{t("join.full")}</Notice> : null}
                <Button
                    label={shooting ? t("join.openCamera") : t("join.seePhotos")}
                    {...(shooting ? { icon: icons.camera } : {})}
                    onPress={next}
                    disabled={draft || full || me.loading}
                />
            </>
        );
    } else if (step === "name") {
        content = (
            <>
                <Text variant="heading" align="center" accessibilityRole="header">
                    {t("join.nameTitle")}
                </Text>
                <Text variant="small" tone="ash" align="center">
                    {t("join.nameBody")}
                </Text>
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
                    onSubmitEditing={() => {
                        submitName().catch(() => null);
                    }}
                    style={{ textAlign: "center", marginBottom: 6 }}
                    accessibilityLabel={t("join.namePlaceholder")}
                />
                {join.error ? <Notice>{joinProblem(join.error.code)}</Notice> : null}
                <Button
                    label={t("common.continue")}
                    loading={join.busy}
                    disabled={name.trim().length === 0}
                    onPress={() => {
                        submitName().catch(() => null);
                    }}
                />
            </>
        );
    } else {
        const blocked = access.granted === false && !access.canAsk;
        content = (
            <>
                <View style={styles.cameraIcon}>
                    <Icon icon={icons.camera} size={40} weight="duotone" />
                </View>
                <Text variant="heading" align="center" accessibilityRole="header">
                    {t("join.cameraTitle")}
                </Text>
                <Text variant="small" tone="ash" align="center">
                    {blocked && Platform.OS === "web"
                        ? t("camera.webDenied")
                        : t("join.cameraBody")}
                </Text>
                {blocked && Platform.OS !== "web" ? (
                    <Button label={t("join.openSettings")} onPress={access.openSettings} />
                ) : (
                    <Button
                        label={blocked ? t("common.retry") : t("join.cameraAllow")}
                        icon={icons.camera}
                        loading={asking}
                        onPress={() => {
                            allow().catch(() => setAsking(false));
                        }}
                    />
                )}
            </>
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
                    <Animated.View key={step} entering={FadeIn.duration(220)} style={styles.sheet}>
                        <View style={styles.grab} />
                        {content}
                    </Animated.View>
                </View>
            </KeyboardAvoidingView>
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
        paddingTop: 12,
        paddingHorizontal: 24,
        paddingBottom: 40,
        gap: 14,
        width: "100%",
        maxWidth: 460,
    },
    grab: {
        width: 40,
        height: 5,
        borderRadius: 3,
        backgroundColor: color.rule,
        alignSelf: "center",
        marginBottom: 6,
    },
    photo: { height: 220, borderRadius: 26, overflow: "hidden", backgroundColor: color.surface },
    noCover: { alignItems: "center", justifyContent: "center" },
    by: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
    cameraIcon: { alignItems: "center", paddingVertical: 12 },
});
