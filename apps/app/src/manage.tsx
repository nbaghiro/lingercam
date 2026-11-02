import type { EventSummary } from "@/api";

// The host's tools on the event screen: the guest count row under the actions and the Manage
// sheet behind the gear button. Both render nothing for guests.

export interface HostToolsProps {
    summary: EventSummary;
    /** Reloads the event screen's summary after a change. */
    onChanged: () => void;
}

/** The gear button in the event's action row, shown to the owner only. */
export function ManageButton(_props: HostToolsProps) {
    return null;
}

/** "7 of 10 guests" with a thin Candle bar and "Make room", under the event's actions. */
export function HostRow(_props: HostToolsProps) {
    return null;
}
