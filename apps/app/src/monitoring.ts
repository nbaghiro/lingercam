import * as Sentry from "@sentry/react-native";
import type { ComponentType } from "react";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || undefined;

// Error tracking is on only when the build has a DSN, so development sends nothing by default.
if (dsn) {
    Sentry.init({
        dsn,
        environment: __DEV__ ? "development" : "production",
        sendDefaultPii: false,
        tracesSampleRate: 0,
    });
}

/** The root layout, wrapped so Sentry sees crashes and unhandled errors when it's on. */
export function withTracking(root: ComponentType): ComponentType {
    return dsn ? Sentry.wrap(root) : root;
}
