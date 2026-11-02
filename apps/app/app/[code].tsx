import { normalizeJoinCode } from "@linger/core/events";
import { Redirect, useLocalSearchParams, type Href } from "expo-router";

import { MissingScreen } from "@/missing";

/** Printed codes link to join.lingercam.app/<code>, which lands here; other paths don't exist. */
export default function CodeRedirect() {
    const { code } = useLocalSearchParams<{ code: string }>();
    const joinCode = normalizeJoinCode(code ?? "");
    if (!joinCode) return <MissingScreen />;
    return <Redirect href={`/j/${joinCode}` as Href} />;
}
