import NetInfo from "@react-native-community/netinfo";
import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { endPastActivities } from "@/activity";
import { loadSession } from "@/api";
import { withTracking } from "@/monitoring";
import { resyncReminders, useNotificationTaps } from "@/notify";
import { claimPending } from "@/purchase";
import { ConfirmHost, FONTS, ToastHost, color } from "@/ui";
import { resumeUploads } from "@/uploads";

SplashScreen.preventAutoHideAsync().catch(() => null);

// The app only reads whether there's a connection, so NetInfo needn't ping an outside server.
NetInfo.configure({ reachabilityShouldRun: () => false });

// A deep link to an event opens with the events list under it, so Back has somewhere to go.
export const unstable_settings = { initialRouteName: "index" };

/** The splash waits this long for the stored session before showing the app anyway. */
const SPLASH_TIMEOUT_MS = 3000;

const theme = {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, background: color.night, card: color.night, text: color.paper },
};

function RootLayout() {
    const [fontsLoaded, fontError] = useFonts(FONTS);
    const [sessionLoaded, setSessionLoaded] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    // The web shows system fonts until its own arrive, so a guest's join sheet never waits.
    const fontsReady = Platform.OS === "web" || fontsLoaded || fontError !== null;
    const ready = fontsReady && (sessionLoaded || timedOut);

    useEffect(() => {
        const timer = setTimeout(() => setTimedOut(true), SPLASH_TIMEOUT_MS);
        loadSession()
            .then(claimPending)
            .catch(() => null)
            .finally(() => setSessionLoaded(true));
        resumeUploads();
        endPastActivities().catch(() => null);
        resyncReminders().catch(() => null);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (ready) SplashScreen.hideAsync().catch(() => null);
    }, [ready]);

    useNotificationTaps(ready);

    if (!ready) return null;
    return (
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.night }}>
            <ThemeProvider value={theme}>
                <StatusBar style="light" />
                <Stack
                    screenOptions={{
                        headerShown: false,
                        contentStyle: { backgroundColor: color.night },
                    }}
                >
                    <Stack.Screen name="settings" options={{ presentation: "modal" }} />
                    <Stack.Screen name="j/[code]" options={{ animation: "fade" }} />
                    <Stack.Screen name="e/[code]/camera" options={{ animation: "fade" }} />
                    <Stack.Screen name="e/[code]/[photo]" options={{ animation: "fade" }} />
                    <Stack.Screen
                        name="e/[code]/recap"
                        options={{ presentation: "fullScreenModal", animation: "fade" }}
                    />
                </Stack>
                <ToastHost />
                <ConfirmHost />
            </ThemeProvider>
        </GestureHandlerRootView>
    );
}

export default withTracking(RootLayout);
