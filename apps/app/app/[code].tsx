import { Redirect, useLocalSearchParams, type Href } from "expo-router";

/** Printed codes link to join.lingercam.app/<code>, which lands here. */
export default function CodeRedirect() {
    const { code } = useLocalSearchParams<{ code: string }>();
    return <Redirect href={`/j/${code ?? ""}` as Href} />;
}
