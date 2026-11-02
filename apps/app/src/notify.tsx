import { normalizeJoinCode } from "@linger/core/events";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router, useFocusEffect, type Href } from "expo-router";
import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";

import {
    api,
    asApiError,
    cached,
    calendarLink,
    currentHostId,
    invalidate,
    PUSH_KEY,
    storage,
    useOnForeground,
    type EventSummary,
} from "@/api";
import { formatTime, problem, t } from "@/copy";
import { Button, Input, Text, color, grid, haptic, radius, space } from "@/ui";

// Notifications. A device that registered for push hears about the reveal from the server; one
// that couldn't register gets a local reminder at the reveal time instead, never both. Guests are
// asked from a card once they have a photo, hosts from the invite, never on opening a screen.

/** What a reminder needs to know about an event: a summary, or a host's event mapped to it. */
export type ReminderEvent = Pick<
    EventSummary,
    "code" | "title" | "revealsAt" | "revealMode" | "timeZone"
>;

const reminderId = (code: string) => `reveal-${code}`;
const reminderKey = (code: string) => `reminder:${code}`;
const answeredKey = (code: string) => `notifyAnswered:${code}`;
const emailKey = (code: string) => `emailAnswered:${code}`;
const HOME_HINT_KEY = "homeScreenHint";

// Which events are on screen. The focused one gets no banner for its own news, and a tap on a
// notification for an event already in the stack goes back to it instead of stacking a copy.

let focused: string | null = null;
const mounted = new Map<string, number>();
const nudges = new Map<string, Set<() => void>>();

function nudge(code: string): void {
    for (const run of nudges.get(code) ?? []) run();
}

/**
 * Marks the event screen for `code` as open while it's mounted and focused. `onNews` runs when a
 * notification about this event arrives, so the screen can reload instead of showing a banner.
 */
export function useEventOnScreen(code: string, onNews: () => void): void {
    const run = useEffectEvent(onNews);
    useEffect(() => {
        mounted.set(code, (mounted.get(code) ?? 0) + 1);
        const set = nudges.get(code) ?? new Set<() => void>();
        nudges.set(code, set);
        const listener = () => run();
        set.add(listener);
        return () => {
            set.delete(listener);
            const left = (mounted.get(code) ?? 1) - 1;
            if (left > 0) mounted.set(code, left);
            else mounted.delete(code);
        };
    }, [code]);
    useFocusEffect(
        useCallback(() => {
            focused = code;
            return () => {
                if (focused === code) focused = null;
            };
        }, [code]),
    );
}

function codeOf(data: Record<string, unknown> | undefined): string | null {
    const raw = data?.code;
    if (typeof raw === "string") return normalizeJoinCode(raw);
    const url = data?.url;
    if (typeof url === "string" && url.startsWith("/e/")) {
        return normalizeJoinCode(url.slice(3).split(/[/?#]/)[0] ?? "");
    }
    return null;
}

function isSilent(data: Record<string, unknown> | undefined): boolean {
    return data?.type === "reveal-changed" || data?.type === "deleted";
}

if (Platform.OS !== "web") {
    Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
            const data = notification.request.content.data;
            const code = codeOf(data);
            // Nothing to show for a silent push, or for news about the event already on screen.
            const show = !isSilent(data) && (code === null || code !== focused);
            return {
                shouldShowBanner: show,
                shouldShowList: show,
                shouldPlaySound: show,
                shouldSetBadge: false,
            };
        },
    });

    // Pushes that arrive while the app is open. Without a background task, a silent push that
    // arrives while the app is closed is caught by `resyncReminders` on the next launch instead.
    Notifications.addNotificationReceivedListener((notification) => {
        const data = notification.request.content.data;
        const code = codeOf(data);
        if (!code) return;
        invalidate(`summary:${code}`);
        if (data?.type === "deleted") {
            cancelReminder(code).catch(() => null);
        } else if (data?.type === "reveal-changed" && typeof data.revealsAt === "string") {
            const known = cached<EventSummary>(`summary:${code}`);
            if (known) remindAtReveal({ ...known, revealsAt: data.revealsAt }).catch(() => null);
            else cancelReminder(code).catch(() => null);
        }
        nudge(code);
    });
}

// Push registration

let registration: { owner: string; done: Promise<boolean> } | null = null;

/**
 * Sends this device's Expo push token to the API, once per launch and host. Resolves to true
 * when the server has it, so the reveal reaches this device by push.
 */
function registerPush(): Promise<boolean> {
    const owner = currentHostId() ?? "";
    if (registration?.owner !== owner) {
        const done = sendPushToken().catch(() => false);
        registration = { owner, done };
        // A failed attempt is tried again next time instead of being remembered.
        done.then((ok) => {
            if (!ok && registration?.done === done) registration = null;
        }).catch(() => null);
    }
    return registration.done;
}

async function sendPushToken(): Promise<boolean> {
    const projectId: unknown =
        Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
    if (typeof projectId !== "string") return false;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    const owner = `${data}|${currentHostId() ?? ""}`;
    if (storage.getString(PUSH_KEY) === owner) return true;
    await api.push(data);
    storage.set(PUSH_KEY, owner);
    return true;
}

/** Cancels this device's reminder for an event, such as one that was deleted. */
export async function cancelReminder(code: string): Promise<void> {
    storage.remove(reminderKey(code));
    await Notifications.cancelScheduledNotificationAsync(reminderId(code));
}

/**
 * Keeps this device's reminder for one event right. Never asks for permission: without it there
 * is nothing to do. With push registered the server sends the reveal, so the local reminder goes.
 */
export async function remindAtReveal(event: ReminderEvent): Promise<void> {
    if (Platform.OS === "web") return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    const pushed = await registerPush().catch(() => false);
    const at = Date.parse(event.revealsAt);
    if (pushed || event.revealMode === "right-away" || at <= Date.now()) {
        await cancelReminder(event.code).catch(() => null);
        return;
    }
    if (storage.getString(reminderKey(event.code)) === event.revealsAt) return;
    await Notifications.cancelScheduledNotificationAsync(reminderId(event.code)).catch(() => null);
    await Notifications.scheduleNotificationAsync({
        identifier: reminderId(event.code),
        content: {
            body: t("notify.revealLocal", { title: event.title }),
            data: { type: "revealed", url: `/e/${event.code}`, code: event.code },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
    });
    storage.set(reminderKey(event.code), event.revealsAt);
}

// Notification taps

const opened = new Set<string>();

/**
 * Opens the event a tapped notification points at. The root layout passes every tap here once
 * the navigator is ready, including the tap that launched the app; each tap opens once. An event
 * already on screen reloads, and one already in the stack is brought back instead of pushed again.
 */
export function handleNotificationOpen(response: Notifications.NotificationResponse | null): void {
    if (!response) return;
    const request = response.notification.request;
    if (opened.has(request.identifier)) return;
    opened.add(request.identifier);
    Notifications.clearLastNotificationResponse();
    const code = codeOf(request.content.data);
    if (!code) return;
    invalidate(`summary:${code}`);
    const href = `/e/${code}` as Href;
    if (focused === code) nudge(code);
    else if (mounted.has(code)) router.dismissTo(href);
    else router.push(href);
}

/** Handles notification taps once the navigator is `ready`, including the tap that launched the app. */
export function useNotificationTaps(ready: boolean): void {
    useEffect(() => {
        if (!ready || Platform.OS === "web") return;
        handleNotificationOpen(Notifications.getLastNotificationResponse());
        const subscription =
            Notifications.addNotificationResponseReceivedListener(handleNotificationOpen);
        return () => subscription.remove();
    }, [ready]);
}

/**
 * Brings every reminder on this device in line with the server: events this device joined and
 * any event with a reminder scheduled. A deleted event's reminder goes. Called once on launch.
 */
export async function resyncReminders(): Promise<void> {
    if (Platform.OS === "web") return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const codes = new Set(
        scheduled
            .map((n) => n.identifier)
            .filter((id) => id.startsWith("reveal-"))
            .map((id) => id.slice("reveal-".length)),
    );
    const joined = await api.guest.joined().catch(() => [] as EventSummary[]);
    for (const summary of joined) {
        codes.delete(summary.code);
        await remindAtReveal(summary).catch(() => null);
    }
    for (const code of codes) {
        try {
            await remindAtReveal(await api.guest.summary(code));
        } catch (error) {
            if (asApiError(error).code === "not-found") {
                await cancelReminder(code).catch(() => null);
            }
        }
    }
}

// The permission card

type Permission = "unknown" | "granted" | "ask" | "off";

async function readPermission(): Promise<Permission> {
    const permission = await Notifications.getPermissionsAsync();
    if (permission.granted) return "granted";
    return permission.canAskAgain ? "ask" : "off";
}

export interface NotifyCardProps {
    event: ReminderEvent;
    /** The host is told on the invite; a guest once they have a photo. */
    audience: "host" | "guest";
}

/**
 * Asks for notifications with the reason in front: "Get a nudge at 10:00 when the photos are
 * ready." with Turn on and Not now. When notifications are off for the app, it points to
 * Settings instead. Shown until answered, once per event. Renders nothing on the web.
 */
export function NotifyCard({ event, audience }: NotifyCardProps) {
    const [permission, setPermission] = useState<Permission>("unknown");
    const [answered, setAnswered] = useState(
        () => storage.getBoolean(answeredKey(event.code)) ?? false,
    );

    const [openedAt] = useState(() => Date.now());
    const recheck = () => {
        readPermission()
            .then((next) => {
                setPermission(next);
                if (next === "granted") remindAtReveal(event).catch(() => null);
            })
            .catch(() => null);
    };
    const check = useEffectEvent(recheck);
    useEffect(() => {
        if (Platform.OS !== "web") check();
    }, [event.code]);
    // Back from Settings with notifications turned on, the reminder is set without a tap.
    useOnForeground(() => {
        if (Platform.OS !== "web") recheck();
    });

    const answer = () => {
        storage.set(answeredKey(event.code), true);
        setAnswered(true);
    };

    const future = Date.parse(event.revealsAt) > openedAt && event.revealMode !== "right-away";
    if (Platform.OS === "web" || answered || !future) return null;
    if (permission === "unknown" || permission === "granted") return null;

    const turnOn = async () => {
        const result = await Notifications.requestPermissionsAsync();
        answer();
        if (result.granted) {
            haptic("success");
            setPermission("granted");
            await remindAtReveal(event);
        }
    };

    const line =
        permission === "off"
            ? t("notify.off")
            : audience === "host"
              ? t("notify.hostCard")
              : t("notify.guestCard", {
                    time: formatTime(new Date(event.revealsAt), event.timeZone),
                });

    return (
        <View style={styles.card}>
            <Text variant="small">{line}</Text>
            <View style={styles.buttons}>
                <Button
                    label={permission === "off" ? t("common.openSettings") : t("common.turnOn")}
                    size="compact"
                    style={styles.button}
                    onPress={() => {
                        if (permission === "off") {
                            answer();
                            Linking.openSettings().catch(() => null);
                        } else {
                            turnOn().catch(() => null);
                        }
                    }}
                />
                <Button
                    label={t("common.notNow")}
                    variant="dark"
                    size="compact"
                    style={styles.button}
                    onPress={answer}
                />
            </View>
        </View>
    );
}

// Browser guests: no push, so an email at the reveal and a calendar entry instead.

function isIosSafari(): boolean {
    if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua);
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    const installed =
        ("standalone" in navigator && navigator.standalone === true) ||
        (typeof window !== "undefined" &&
            window.matchMedia?.("(display-mode: standalone)").matches === true);
    return ios && safari && !installed;
}

/**
 * The browser guest's card: "Want to know when the photos are ready?" with an email field and
 * "Add to calendar". Once it's answered, iOS Safari shows "Add to Home Screen to come back
 * later" once. Renders nothing in the app.
 */
export function EmailCard({ event }: { event: ReminderEvent }) {
    const [answered, setAnswered] = useState(
        () => Platform.OS === "web" && (storage.getBoolean(emailKey(event.code)) ?? false),
    );
    const [openedAt] = useState(() => Date.now());
    const [email, setEmail] = useState("");
    const [saved, setSaved] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Decided once, so the hint stays for this visit after it's marked as shown.
    const [hint] = useState(
        () => isIosSafari() && !(storage.getBoolean(HOME_HINT_KEY) ?? false) && answered,
    );
    useEffect(() => {
        if (hint) storage.set(HOME_HINT_KEY, true);
    }, [hint]);

    if (Platform.OS !== "web") return null;
    const future = Date.parse(event.revealsAt) > openedAt;

    const answer = () => {
        storage.set(emailKey(event.code), true);
        setAnswered(true);
    };

    if (hint) {
        return (
            <Text variant="caption" tone="ash" align="center" style={styles.hint}>
                {t("notify.homeScreen")}
            </Text>
        );
    }
    if (saved) {
        return (
            <View style={styles.card}>
                <Text variant="small" accessibilityRole="alert" accessibilityLiveRegion="polite">
                    {t("notify.emailSaved")}
                </Text>
            </View>
        );
    }
    if (answered || !future) return null;

    const send = async () => {
        const address = email.trim();
        if (!address.includes("@")) return;
        setBusy(true);
        setError(null);
        try {
            await api.guest.email(event.code, address);
            answer();
            setSaved(true);
        } catch (failure) {
            setError(problem(asApiError(failure).code));
        } finally {
            setBusy(false);
        }
    };

    return (
        <View style={styles.card}>
            <Text variant="name">{t("notify.webTitle")}</Text>
            <Input
                value={email}
                onChangeText={setEmail}
                placeholder={t("notify.emailPlaceholder")}
                accessibilityLabel={t("notify.emailMe")}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                inputMode="email"
                onSubmitEditing={() => {
                    send().catch(() => null);
                }}
            />
            {error ? (
                <Text variant="caption" tone="ash" accessibilityRole="alert">
                    {error}
                </Text>
            ) : null}
            <View style={styles.buttons}>
                <Button
                    label={t("notify.emailMe")}
                    size="compact"
                    style={styles.button}
                    loading={busy}
                    disabled={!email.includes("@")}
                    onPress={() => {
                        send().catch(() => null);
                    }}
                />
                <Button
                    label={t("notify.calendar")}
                    variant="dark"
                    size="compact"
                    style={styles.button}
                    onPress={() => {
                        Linking.openURL(calendarLink(event.code)).catch(() => null);
                    }}
                />
            </View>
            <Button label={t("common.notNow")} variant="glass" size="compact" onPress={answer} />
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: grid.side,
        marginBottom: space.m,
        padding: space.l,
        gap: space.m,
        borderRadius: radius.row,
        backgroundColor: color.surface,
    },
    buttons: { flexDirection: "row", gap: space.s },
    button: { flex: 1 },
    hint: { paddingHorizontal: space.xl, marginBottom: space.m },
});
