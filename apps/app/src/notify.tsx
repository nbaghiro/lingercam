import { normalizeJoinCode } from "@linger/core/events";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { router, type Href } from "expo-router";
import { Platform } from "react-native";

import { api, currentHostId, PUSH_KEY, storage, type EventSummary } from "@/api";
import { t } from "@/copy";

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

export async function remindAtReveal(summary: EventSummary): Promise<void> {
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

/** Opens the event a tapped notification points at. The root layout passes every tap here. */
export function handleNotificationOpen(response: Notifications.NotificationResponse | null): void {
    const data = response?.notification.request.content.data;
    const url: unknown = data?.url;
    const code: unknown = data?.code;
    if (typeof url === "string" && url.startsWith("/e/")) router.push(url as Href);
    else if (typeof code === "string" && normalizeJoinCode(code)) {
        router.push(`/e/${normalizeJoinCode(code)}` as Href);
    }
}

/** Brings every scheduled reveal reminder in line with the server. Called once on launch. */
export async function resyncReminders(): Promise<void> {}
