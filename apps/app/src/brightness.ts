import * as Brightness from "expo-brightness";

/**
 * Turns the screen all the way up for a front-camera flash, so a selfie in a dark room is lit
 * whatever the brightness was. Returns a call that puts it back.
 */
export async function brighten(): Promise<() => void> {
    const before = await Brightness.getBrightnessAsync().catch(() => null);
    await Brightness.setBrightnessAsync(1).catch(() => null);
    return () => {
        if (before !== null) Brightness.setBrightnessAsync(before).catch(() => null);
    };
}
