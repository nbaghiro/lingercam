import type { Event } from "@linger/core/events";
import { Asset } from "expo-asset";
import * as Clipboard from "expo-clipboard";
import { File } from "expo-file-system";
import * as Print from "expo-print";
import { useEffect, useRef, useState } from "react";
import {
    Platform,
    Pressable,
    Share,
    StyleSheet,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { api, joinLink, useLoad, type EventSummary } from "@/api";
import { formatDay, formatTime, formatWhen, t } from "@/copy";
import { NotifyCard } from "@/notify";
import {
    Button,
    Mark,
    Screen,
    Sheet,
    Text,
    color,
    haptic,
    icons,
    radius,
    space,
    useReduceMotion,
} from "@/ui";

/** The QR code's drawing, which can render itself to a base64 PNG for printing. */
export interface QrHandle {
    toDataURL: (callback: (base64Png: string) => void) => void;
}

export interface InviteCardProps {
    title: string;
    url: string;
    caption: string;
    /** The join code, letter-spaced under the QR so it can be read aloud or written down. */
    code?: string;
    size?: number;
    qrRef?: (ref: QrHandle | null) => void;
}

/** "M A Y A 3 X", so a screen reader reads the code letter by letter. */
function spelled(code: string): string {
    return code.split("").join(" ");
}

/** The cream card with the mark, a real QR code for the join link, the code and the name. */
export function InviteCard({ title, url, caption, code, size = 220, qrRef }: InviteCardProps) {
    const label = [title, caption, code ? t("invite.code", { code: spelled(code) }) : null]
        .filter(Boolean)
        .join(". ");
    return (
        <View style={styles.inviteCard} accessible accessibilityLabel={label}>
            <Mark size={26} tint={color.ink} />
            <View style={{ marginTop: 18, marginBottom: code ? 12 : 16 }}>
                <QRCode
                    value={url}
                    size={size}
                    color={color.ink}
                    backgroundColor={color.cream}
                    {...(qrRef ? { getRef: (ref: QrHandle | null) => qrRef(ref) } : {})}
                />
            </View>
            {code ? (
                <Text weight="semibold" align="center" style={styles.code}>
                    {code}
                </Text>
            ) : null}
            <Text variant="heading" align="center" style={{ color: color.ink }}>
                {title}
            </Text>
            <Text variant="small" tone="faint" align="center" style={{ marginTop: 8 }}>
                {caption}
            </Text>
        </View>
    );
}

/**
 * Opens the share sheet with the link once. iOS takes the link as `url` and the words as
 * `message`, so `text` (the words without the link) goes there when given.
 */
export async function shareLink(
    title: string,
    url: string,
    message: string,
    text?: string,
): Promise<void> {
    if (Platform.OS === "web") {
        if (navigator.share) await navigator.share({ title, url });
        else await navigator.clipboard?.writeText(url);
        return;
    }
    if (Platform.OS === "ios") {
        await Share.share({ message: text ?? message, url });
        return;
    }
    await Share.share({ message });
}

/** Puts the join link on the clipboard. */
export async function copyLink(url: string): Promise<void> {
    await Clipboard.setStringAsync(url);
}

/** A "Copy link" button that reads "Link copied" for 2 seconds after a tap. */
export function CopyLinkButton({ url, style }: { url: string; style?: StyleProp<ViewStyle> }) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const id = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(id);
    }, [copied]);
    return (
        <Button
            label={copied ? t("common.copied") : t("invite.copyLink")}
            {...(copied ? { icon: icons.check } : {})}
            variant="dark"
            style={style}
            onPress={() => {
                copyLink(url)
                    .then(() => {
                        haptic("light");
                        setCopied(true);
                    })
                    .catch(() => null);
            }}
        />
    );
}

function share(title: string, url: string): void {
    shareLink(
        title,
        url,
        t("create.invite.shareMessage", { title, url }),
        t("invite.shareText", { title }),
    ).catch(() => null);
}

// Table cards

/** What a table card says about the event. An `Event` and an `EventSummary` both supply it. */
export interface CardFacts {
    title: string;
    code: string;
    revealMode: Event["settings"]["revealMode"];
    startsAt: string;
    revealsAt: string;
    timeZone: string;
    shotsPerGuest: number | null;
}

export function factsOfEvent(event: Event): CardFacts {
    const s = event.settings;
    return {
        title: s.title,
        code: event.code,
        revealMode: s.revealMode,
        startsAt: s.startsAt,
        revealsAt: event.revealsAt,
        timeZone: s.timeZone,
        shotsPerGuest: s.shotsPerGuest,
    };
}

export function factsOfSummary(summary: EventSummary): CardFacts {
    return {
        title: summary.title,
        code: summary.code,
        revealMode: summary.revealMode,
        startsAt: summary.startsAt,
        revealsAt: summary.revealsAt,
        timeZone: summary.timeZone,
        shotsPerGuest: summary.shotsPerGuest,
    };
}

/** True where the table cards can be printed: the print sheet exists on iOS and Android. */
export const canPrint = Platform.OS !== "web";

/**
 * Printing table cards. The QR code renders itself to a PNG, so the caller places a QR, either a
 * visible invite card or `PrintQr`, and passes its ref through `setQr`.
 */
export function useTableCards(facts: CardFacts | null) {
    const qr = useRef<QrHandle | null>(null);
    const [printing, setPrinting] = useState(false);
    const print = () => {
        const ref = qr.current;
        if (!ref || !facts) return;
        setPrinting(true);
        ref.toDataURL((png) => {
            fontCss()
                .then((css) => Print.printAsync({ html: tableCards(facts, png, css) }))
                .catch(() => null)
                .finally(() => setPrinting(false));
        });
    };
    return {
        printing,
        print,
        setQr: (ref: QrHandle | null) => {
            qr.current = ref;
        },
    };
}

/** A QR code drawn out of sight, for printing from a screen that doesn't show one. */
export function PrintQr({ url, onRef }: { url: string; onRef: (ref: QrHandle | null) => void }) {
    return (
        <View
            style={styles.hiddenQr}
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
        >
            <QRCode
                value={url}
                size={360}
                color={color.ink}
                backgroundColor={color.white}
                getRef={(ref: QrHandle | null) => onRef(ref)}
            />
        </View>
    );
}

let embeddedFont: Promise<string> | null = null;

/**
 * The serif as a base64 font face, so the cards print in Newsreader without a connection. If the
 * file can't be read, the cards fall back to Georgia.
 */
function fontCss(): Promise<string> {
    embeddedFont ??= (async () => {
        const [asset] = await Asset.loadAsync(require("../assets/fonts/Newsreader-Text.ttf"));
        if (!asset?.localUri) return "";
        const data = await new File(asset.localUri).base64();
        return `@font-face { font-family: "Newsreader"; src: url(data:font/ttf;base64,${data}) format("truetype"); }`;
    })().catch(() => {
        embeddedFont = null;
        return "";
    });
    return embeddedFont;
}

function escape(text: string): string {
    return text.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
    );
}

/**
 * When the photos appear, phrased for someone reading the card at the event rather than on the
 * day it was printed: "tomorrow at 10:00" is the morning after the event starts.
 */
function cardWhen(facts: CardFacts): string {
    const zone = facts.timeZone;
    const starts = new Date(facts.startsAt);
    const reveals = new Date(facts.revealsAt);
    const time = formatTime(reveals, zone);
    const day = formatDay(reveals, zone);
    if (day === formatDay(starts, zone)) return t("revealWhen.today", { time });
    if (day === formatDay(new Date(starts.getTime() + 86_400_000), zone)) {
        return t("revealWhen.tomorrow", { time });
    }
    return t("revealWhen.date", { date: day, time });
}

/** The card's rules line: "24 shots each. Photos appear tomorrow at 10:00." */
export function cardRules(facts: CardFacts): string {
    const shots = facts.shotsPerGuest;
    if (facts.revealMode === "right-away") {
        return shots === null
            ? t("print.rulesRightAwayUnlimited")
            : t("print.rulesRightAway", { shots });
    }
    const when = cardWhen(facts);
    return shots === null ? t("print.rulesUnlimited", { when }) : t("print.rules", { shots, when });
}

/** Four table cards on one A4 or Letter page, to cut out and fold. */
export function tableCards(facts: CardFacts, qrPng: string, fontFace = ""): string {
    const card = `<div class="card">
        <svg width="28" height="28" viewBox="0 0 32 32"><circle cx="12" cy="16" r="9" fill="none" stroke="#121210" stroke-width="2.2"/><circle cx="20" cy="16" r="9" fill="#121210" fill-opacity=".9"/></svg>
        <p class="scan">${escape(t("print.scan"))}</p>
        <img src="data:image/png;base64,${qrPng}" alt="">
        <p class="code">${escape(facts.code)}</p>
        <h2>${escape(facts.title)}</h2>
        <p class="rules">${escape(cardRules(facts))}</p>
        <p class="how">${escape(t("print.point"))}</p>
    </div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(t("print.title", { title: facts.title }))}</title>
    <style>
        ${fontFace}
        @page { margin: 12mm; }
        body { margin: 0; font-family: -apple-system, "Helvetica Neue", sans-serif; color: #121210; }
        .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
        .card { border: 1px dashed #c9c6bf; border-radius: 6mm; padding: 8mm 7mm; text-align: center; break-inside: avoid; }
        .scan { font-size: 11pt; color: #6D6B65; margin: 4mm 0; }
        img { width: 44mm; height: 44mm; }
        .code { font-size: 13pt; font-weight: 600; letter-spacing: 0.3em; margin: 2mm 0 0; padding-left: 0.3em; }
        h2 { font-family: Newsreader, Georgia, serif; font-weight: 400; font-size: 20pt; margin: 3mm 0 2mm; }
        .rules { font-size: 10pt; margin: 0 0 1.5mm; }
        .how { font-size: 9pt; color: #6D6B65; margin: 0; }
    </style></head><body><div class="sheet">${card.repeat(4)}</div></body></html>`;
}

// The invite sheet, from the event and the camera

export function InviteSheet({
    visible,
    onClose,
    code,
    title,
}: {
    visible: boolean;
    onClose: () => void;
    code: string;
    title: string;
}) {
    const url = joinLink(code);
    const summary = useLoad(`summary:${code}`, () => api.guest.summary(code));
    const host = summary.data?.viewer.role === "host";
    const cards = useTableCards(summary.data ? factsOfSummary(summary.data) : null);
    return (
        <Sheet visible={visible} onClose={onClose}>
            <InviteCard
                title={title}
                url={url}
                code={code}
                caption={t("create.invite.scan")}
                size={200}
                qrRef={cards.setQr}
            />
            <View style={styles.pair}>
                <CopyLinkButton url={url} style={{ flex: 1 }} />
                <Button
                    label={t("create.invite.share")}
                    icon={icons.share}
                    variant="dark"
                    style={{ flex: 1 }}
                    onPress={() => share(title, url)}
                />
            </View>
            {host && canPrint ? (
                <Button
                    label={t("create.invite.print")}
                    icon={icons.print}
                    variant="dark"
                    loading={cards.printing}
                    onPress={cards.print}
                />
            ) : null}
        </Sheet>
    );
}

// The invite after creating

export function Invite({ event, onDone }: { event: Event; onDone: () => void }) {
    const url = joinLink(event.code);
    const title = event.settings.title;
    const cards = useTableCards(factsOfEvent(event));
    const still = useReduceMotion();
    const [now] = useState(() => new Date());
    const startsAt = new Date(event.settings.startsAt);
    const scheduled = startsAt.getTime() > now.getTime();

    // Going live: a success haptic, and the card settles in from 96%.
    const scale = useSharedValue(still ? 1 : 0.96);
    const opacity = useSharedValue(0);
    useEffect(() => {
        haptic("success");
        scale.value = withTiming(1, { duration: 320 });
        opacity.value = withTiming(1, { duration: 240 });
    }, [scale, opacity]);
    const appear = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ scale: scale.value }],
    }));

    return (
        <Screen
            scroll
            footer={
                <View style={{ gap: space.s }}>
                    <Button
                        label={t("create.invite.print")}
                        icon={icons.print}
                        loading={cards.printing}
                        onPress={cards.print}
                    />
                    <View style={styles.pair}>
                        <CopyLinkButton url={url} style={{ flex: 1 }} />
                        <Button
                            label={t("create.invite.share")}
                            icon={icons.share}
                            variant="dark"
                            style={{ flex: 1 }}
                            onPress={() => share(title, url)}
                        />
                    </View>
                </View>
            }
        >
            <View style={styles.doneRow}>
                <Pressable onPress={onDone} accessibilityRole="button" hitSlop={12}>
                    <Text weight="semibold">{t("create.invite.done")}</Text>
                </Pressable>
            </View>
            <Text variant="title" align="center" accessibilityRole="header">
                {t("create.invite.title")}
            </Text>
            <Animated.View style={appear}>
                <InviteCard
                    title={title}
                    url={url}
                    code={event.code}
                    caption={t("create.invite.scan")}
                    qrRef={cards.setQr}
                />
            </Animated.View>
            {scheduled ? (
                <Text variant="small" tone="ash" align="center" style={{ marginBottom: space.l }}>
                    {t("invite.opens", {
                        when: formatWhen(now, startsAt, event.settings.timeZone),
                    })}
                </Text>
            ) : null}
            <NotifyCard
                event={{
                    code: event.code,
                    title: event.settings.title,
                    revealsAt: event.revealsAt,
                    revealMode: event.settings.revealMode,
                    timeZone: event.settings.timeZone,
                }}
                audience="host"
            />
        </Screen>
    );
}

const styles = StyleSheet.create({
    inviteCard: {
        backgroundColor: color.cream,
        borderRadius: radius.invite,
        paddingTop: 28,
        paddingHorizontal: 24,
        paddingBottom: 24,
        alignItems: "center",
        marginVertical: 22,
    },
    code: {
        color: color.ink,
        fontSize: 17,
        letterSpacing: 5,
        // Letter spacing trails the last letter too; this keeps the code centred.
        paddingLeft: 5,
        marginBottom: 10,
    },
    doneRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: space.m },
    pair: { flexDirection: "row", gap: space.s },
    hiddenQr: { position: "absolute", top: 0, left: 0, opacity: 0 },
});
