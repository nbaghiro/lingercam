import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { endPastActivities } from "@/activity";
import { loadSession } from "@/api";
import { useRevealLinks } from "@/event";
import { claimPending } from "@/purchase";
import { FONTS, color } from "@/ui";
import { resumeUploads } from "@/uploads";

SplashScreen.preventAutoHideAsync().catch(() => null);

const theme = {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, background: color.night, card: color.night, text: color.paper },
};

export default function RootLayout() {
    const [fontsLoaded, fontError] = useFonts(FONTS);
    const [sessionLoaded, setSessionLoaded] = useState(false);
    const ready = (fontsLoaded || fontError !== null) && sessionLoaded;

    useEffect(() => {
        loadSession()
            .then(claimPending)
            .catch(() => null)
            .finally(() => setSessionLoaded(true));
        resumeUploads();
        endPastActivities().catch(() => null);
    }, []);
    useRevealLinks();

    useEffect(() => {
        if (ready) SplashScreen.hideAsync().catch(() => null);
    }, [ready]);

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
            </ThemeProvider>
        </GestureHandlerRootView>
    );
}
