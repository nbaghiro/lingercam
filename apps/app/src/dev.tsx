import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { SCREENSHOTS_KEY, api, currentHostId, resetDevice, storage } from "@/api";
import { MissingScreen } from "@/missing";
import { Text, color } from "@/ui";

const PERSONAS = ["power", "new", "half", "guest", "out"] as const;
type Persona = (typeof PERSONAS)[number];

/**
 * Development only: `linger://dev/<persona>` puts the device in a demo state and opens Home.
 * power, new and half sign in as those demo hosts; guest signs out and takes the demo guest's
 * places at the seeded events; out signs out with nothing joined. `?shots=1` hides the controls
 * only development builds have, for screenshots, and `?shots=0` brings them back.
 */
export function DevScreen() {
    const { persona, shots } = useLocalSearchParams<{ persona: string; shots?: string }>();
    if (!__DEV__ || !PERSONAS.includes(persona as Persona)) return <MissingScreen />;
    return <Switch persona={persona as Persona} shots={shots} />;
}

function Switch({ persona, shots }: { persona: Persona; shots: string | undefined }) {
    const router = useRouter();
    const [problem, setProblem] = useState<string | null>(null);

    useEffect(() => {
        if (shots === "1") storage.set(SCREENSHOTS_KEY, "1");
        if (shots === "0") storage.remove(SCREENSHOTS_KEY);
        (async () => {
            if (currentHostId()) await api.auth.signOut();
            resetDevice();
            if (persona === "power") await api.auth.demo();
            if (persona === "new" || persona === "half") await api.auth.demo(persona);
            await api.auth.demoGuest(persona !== "guest");
            // Start Home afresh, so no screen from the last account stays underneath.
            if (router.canDismiss()) router.dismissAll();
            router.replace("/" as Href);
        })().catch((error: unknown) => setProblem(String(error)));
    }, [persona, shots, router]);

    return (
        <View style={styles.fill}>
            {problem ? (
                <Text tone="ash">{problem}</Text>
            ) : (
                <ActivityIndicator color={color.paper} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
