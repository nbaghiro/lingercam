import { JOIN_ALPHABET, JOIN_CODE_LENGTH, normalizeJoinCode } from "@linger/core/events";
import { shootingPhase } from "@linger/core/shots";
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";

import { api, useLoad, type EventSummary } from "@/api";
import { formatWhen, revealWhen, t } from "@/copy";
import { isRevealed, useEventClock } from "@/shutter";
import { Button, Icon, Mark, Text, color, haptic, icons, radius, space } from "@/ui";

// Events this device joined as a guest, and the six-box code entry ("Have a code?"). The native
// welcome and the web guest home show both.

export interface JoinedEventsProps {
    /** Opens an event the device joined. */
    onOpen?: (code: string) => void;
}

function statusLine(event: EventSummary, now: Date): string {
    if (event.state === "draft") return t("joined.draft");
    if (isRevealed(event, now)) return t("joined.ready");
    const phase = shootingPhase(event, now);
    if (phase === "open") return t("joined.open");
    if (phase === "before") {
        return t("joined.before", {
            when: formatWhen(now, new Date(event.startsAt), event.timeZone),
        });
    }
    return t("joined.waiting", {
        when: revealWhen(now, new Date(event.revealsAt), event.timeZone),
    });
}

/**
 * "Events you joined": every event this device joined, newest first, from the device-scoped
 * `/v1/joined`. A deleted event drops out because the server no longer lists it. Renders nothing
 * until there is at least one.
 */
export function JoinedEvents({ onOpen }: JoinedEventsProps) {
    const router = useRouter();
    const joined = useLoad("joined", () => api.guest.joined());
    const now = useEventClock([]);
    const events = joined.data ?? [];
    if (events.length === 0) return null;

    const open = (code: string) => {
        if (onOpen) onOpen(code);
        else router.push(`/e/${code}` as Href);
    };

    return (
        <View style={styles.list}>
            <Text variant="caption" tone="ash" accessibilityRole="header" style={styles.heading}>
                {t("joined.title")}
            </Text>
            {events.map((event) => {
                const line = statusLine(event, now);
                const live =
                    event.state !== "draft" &&
                    !isRevealed(event, now) &&
                    shootingPhase(event, now) === "open";
                return (
                    <Pressable
                        key={event.code}
                        onPress={() => open(event.code)}
                        accessibilityRole="button"
                        accessibilityLabel={`${event.title}. ${line}`}
                        style={({ pressed }) => [styles.row, pressed ? { opacity: 0.8 } : null]}
                    >
                        <View style={styles.thumb}>
                            {event.coverUrl ? (
                                <Image
                                    source={event.coverUrl}
                                    style={StyleSheet.absoluteFill}
                                    contentFit="cover"
                                />
                            ) : (
                                <Mark size={22} tint={color.faint} />
                            )}
                        </View>
                        <View style={styles.rowText}>
                            <Text variant="name" numberOfLines={1}>
                                {event.title}
                            </Text>
                            <Text variant="small" tone={live ? "candle" : "ash"} numberOfLines={1}>
                                {line}
                            </Text>
                        </View>
                        <Icon icon={icons.chevron} size={16} color={color.ash} />
                    </Pressable>
                );
            })}
        </View>
    );
}

export interface CodeEntryProps {
    /** Prefills the boxes, such as a code that wasn't found. */
    initialCode?: string;
    /** Called with a complete, normalised code. */
    onSubmit: (code: string) => void;
}

/** Keeps the characters a join code can hold, from typing or a pasted code or link. */
export function cleanCode(input: string): string {
    const text = input.includes("/") ? (input.trim().split("/").pop() ?? "") : input;
    let out = "";
    for (const ch of text.toUpperCase()) {
        if (JOIN_ALPHABET.includes(ch)) out += ch;
        if (out.length === JOIN_CODE_LENGTH) break;
    }
    return out;
}

/**
 * Six boxes that advance as the guest types and accept a pasted code or link. One text field
 * sits over the boxes, so typing, deleting and pasting behave as in any field.
 */
export function CodeEntry({ initialCode, onSubmit }: CodeEntryProps) {
    const input = useRef<TextInputInstance>(null);
    const [value, setValue] = useState(() => cleanCode(initialCode ?? ""));
    const [focused, setFocused] = useState(false);
    const complete = normalizeJoinCode(value);

    const change = (text: string) => {
        const next = cleanCode(text);
        if (next.length > value.length) haptic("selection");
        setValue(next);
        const code = normalizeJoinCode(next);
        // The sixth character, typed or pasted, joins straight away.
        if (code && value.length < JOIN_CODE_LENGTH) onSubmit(code);
    };

    return (
        <View style={styles.entry}>
            <Text variant="heading" align="center" accessibilityRole="header">
                {t("code.title")}
            </Text>
            <Text variant="small" tone="ash" align="center">
                {t("code.body")}
            </Text>
            <Pressable onPress={() => input.current?.focus()} style={styles.boxes}>
                {Array.from({ length: JOIN_CODE_LENGTH }, (_, index) => {
                    const ch = value[index] ?? "";
                    const caret = focused && index === Math.min(value.length, JOIN_CODE_LENGTH - 1);
                    return (
                        <View
                            key={index}
                            style={[styles.box, caret ? styles.boxActive : null]}
                            importantForAccessibility="no-hide-descendants"
                            accessibilityElementsHidden
                        >
                            <Text serif style={styles.char}>
                                {ch}
                            </Text>
                        </View>
                    );
                })}
                <TextInput
                    ref={input}
                    value={value}
                    onChangeText={change}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={64}
                    returnKeyType="go"
                    onSubmitEditing={() => {
                        if (complete) onSubmit(complete);
                    }}
                    accessibilityLabel={t("code.label")}
                    caretHidden
                    selectionColor="transparent"
                    style={styles.hidden}
                />
            </Pressable>
            <Button
                label={t("code.join")}
                disabled={complete === null}
                onPress={() => {
                    if (complete) onSubmit(complete);
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    list: { gap: space.s },
    heading: { textTransform: "uppercase", letterSpacing: 0.6, marginBottom: space.xs },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        padding: space.m,
        borderRadius: radius.row,
        backgroundColor: color.surface,
    },
    thumb: {
        width: 48,
        height: 48,
        borderRadius: radius.s,
        overflow: "hidden",
        backgroundColor: color.raised,
        alignItems: "center",
        justifyContent: "center",
    },
    rowText: { flex: 1, minWidth: 0, gap: space.xxs },
    entry: { gap: 14 },
    boxes: { flexDirection: "row", justifyContent: "center", gap: space.s },
    box: {
        width: 46,
        height: 58,
        borderRadius: radius.control,
        backgroundColor: color.surface,
        borderWidth: 1.5,
        borderColor: color.rule,
        alignItems: "center",
        justifyContent: "center",
    },
    boxActive: { borderColor: color.candle },
    char: { fontSize: 26, lineHeight: 32, color: color.paper },
    hidden: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        opacity: 0.02,
        color: "transparent",
        fontSize: 16,
    },
});
