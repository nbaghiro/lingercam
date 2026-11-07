/** A page can't change the screen's brightness, so the white flash does what it can. */
export async function brighten(): Promise<() => void> {
    return () => undefined;
}
