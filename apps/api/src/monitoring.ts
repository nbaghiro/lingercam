import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN || undefined;

// Error tracking is on only when SENTRY_DSN is set, so local runs and tests send nothing.
if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
        release: process.env.RENDER_GIT_COMMIT,
        serverName: process.env.ROLE ?? "all",
    });
}

export const tracking = dsn !== undefined;

/** Sends an error to Sentry: the exception with its stack when there is one, else the message. */
export function track(message: string, extra: Record<string, unknown>, cause?: unknown): void {
    if (!tracking) return;
    if (cause === undefined) Sentry.captureMessage(message, { level: "error", extra });
    else Sentry.captureException(cause, { extra: { message, ...extra } });
}

/** Sends what's waiting before the process exits. */
export async function flushTracking(): Promise<void> {
    if (tracking) await Sentry.flush(2000);
}
