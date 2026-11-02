// Events this device joined as a guest, and the six-box code entry ("Have a code?"). The native
// welcome and the web guest home show both.

export interface JoinedEventsProps {
    /** Opens an event the device joined. */
    onOpen?: (code: string) => void;
}

/** "Your events" for a guest: every event this device joined, newest first. */
export function JoinedEvents(_props: JoinedEventsProps) {
    return null;
}

export interface CodeEntryProps {
    /** Prefills the boxes, such as a code that wasn't found. */
    initialCode?: string;
    /** Called with a complete, normalised code. */
    onSubmit: (code: string) => void;
}

/** Six boxes that advance as the guest types and accept a pasted code. */
export function CodeEntry(_props: CodeEntryProps) {
    return null;
}
