import type { Event } from "@linger/core/events";
import * as Print from "expo-print";
import { useRef, useState } from "react";
import { Platform, Share, StyleSheet, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

import { joinLink } from "@/api";
import { revealWhen, t } from "@/copy";
import { Button, IconButton, Mark, Screen, Sheet, Text, color, icons } from "@/ui";

/** The QR code's drawing, which can render itself to a base64 PNG for printing. */
export interface QrHandle {
    toDataURL: (callback: (base64Png: string) => void) => void;
}

export interface InviteCardProps {
    title: string;
    url: string;
    caption: string;
    size?: number;
    qrRef?: (ref: QrHandle | null) => void;
}

/** The cream card with the mark, a real QR code for the join link, and the event name. */
export function InviteCard({ title, url, caption, size = 220, qrRef }: InviteCardProps) {
    return (
        <View style={styles.inviteCard} accessible accessibilityLabel={`${title}. ${caption}`}>
            <Mark size={26} tint={color.ink} />
            <View style={{ marginTop: 18, marginBottom: 16 }}>
                <QRCode
                    value={url}
                    size={size}
                    color={color.ink}
                    backgroundColor={color.cream}
                    {...(qrRef ? { getRef: (ref: QrHandle | null) => qrRef(ref) } : {})}
                />
            </View>
            <Text variant="heading" align="center" style={{ color: color.ink }}>
                {title}
            </Text>
            <Text variant="small" tone="faint" align="center" style={{ marginTop: 8 }}>
                {caption}
            </Text>
        </View>
    );
}

export async function shareLink(title: string, url: string, message: string): Promise<void> {
    if (Platform.OS === "web") {
        if (navigator.share) await navigator.share({ title, url });
        else await navigator.clipboard?.writeText(url);
        return;
    }
    await Share.share({ message, ...(Platform.OS === "ios" ? { url } : {}) });
}

// The invite sheet, also opened from the camera

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
    return (
        <Sheet visible={visible} onClose={onClose}>
            <InviteCard title={title} url={url} caption={t("create.invite.scan")} size={200} />
            <Button
                label={t("create.invite.share")}
                icon={icons.share}
                variant="dark"
                onPress={() => {
                    shareLink(title, url, t("create.invite.shareMessage", { title, url })).catch(
                        () => null,
                    );
                }}
            />
        </Sheet>
    );
}

// The invite card

export function Invite({ event, onDone }: { event: Event; onDone: () => void }) {
    const url = joinLink(event.code);
    const title = event.settings.title;
    const qr = useRef<QrHandle | null>(null);
    const [printing, setPrinting] = useState(false);

    const print = () => {
        const ref = qr.current;
        if (!ref) return;
        setPrinting(true);
        ref.toDataURL((data) => {
            Print.printAsync({ html: tableCards(event, data) })
                .catch(() => null)
                .finally(() => setPrinting(false));
        });
    };

    const share = () => {
        Share.share({
            message: t("create.invite.shareMessage", { title, url }),
            ...(Platform.OS === "ios" ? { url } : {}),
        }).catch(() => null);
    };

    return (
        <Screen
            footer={
                <View style={{ gap: 10 }}>
                    <Button
                        label={t("create.invite.print")}
                        icon={icons.print}
                        loading={printing}
                        onPress={print}
                    />
                    <Button
                        label={t("create.invite.share")}
                        icon={icons.share}
                        variant="dark"
                        onPress={share}
                    />
                </View>
            }
        >
            <View style={styles.inviteHead}>
                <Text variant="title" align="center" accessibilityRole="header">
                    {t("create.invite.title")}
                </Text>
                <View style={styles.inviteClose}>
                    <IconButton
                        icon={icons.close}
                        onPress={onDone}
                        accessibilityLabel={t("create.invite.done")}
                    />
                </View>
            </View>
            <InviteCard
                title={title}
                url={url}
                caption={t("create.invite.scan")}
                qrRef={(ref) => {
                    qr.current = ref;
                }}
            />
        </Screen>
    );
}

function escape(text: string): string {
    return text.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
    );
}

/** Four table cards on one A4 or Letter page, to cut out and fold. */
function tableCards(event: Event, qrPng: string): string {
    const { title, revealMode, timeZone: zone } = event.settings;
    const how =
        revealMode === "right-away"
            ? t("print.howRightAway")
            : t("print.how", { when: revealWhen(new Date(), new Date(event.revealsAt), zone) });
    const card = `<div class="card">
        <svg width="28" height="28" viewBox="0 0 32 32"><circle cx="12" cy="16" r="9" fill="none" stroke="#121210" stroke-width="2.2"/><circle cx="20" cy="16" r="9" fill="#121210" fill-opacity=".9"/></svg>
        <p class="scan">${escape(t("print.scan"))}</p>
        <img src="data:image/png;base64,${qrPng}" alt="">
        <h2>${escape(title)}</h2>
        <p class="how">${escape(how)}</p>
    </div>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(t("print.title", { title }))}</title>
    <link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz@6..72&display=swap" rel="stylesheet">
    <style>
        @page { margin: 12mm; }
        body { margin: 0; font-family: -apple-system, "Helvetica Neue", sans-serif; color: #121210; }
        .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
        .card { border: 1px dashed #c9c6bf; border-radius: 6mm; padding: 9mm 7mm; text-align: center; break-inside: avoid; }
        .scan { font-size: 11pt; color: #6D6B65; margin: 4mm 0; }
        img { width: 46mm; height: 46mm; }
        h2 { font-family: Newsreader, Georgia, serif; font-weight: 400; font-size: 20pt; margin: 4mm 0 2mm; }
        .how { font-size: 9pt; color: #6D6B65; margin: 0; }
    </style></head><body><div class="sheet">${card.repeat(4)}</div></body></html>`;
}

const styles = StyleSheet.create({
    inviteCard: {
        backgroundColor: color.cream,
        borderRadius: 32,
        paddingTop: 28,
        paddingHorizontal: 24,
        paddingBottom: 24,
        alignItems: "center",
        marginVertical: 22,
    },
    inviteHead: { marginTop: 6, justifyContent: "center" },
    // Beside the centred title, as the design has no row above it.
    inviteClose: { position: "absolute", left: 0, top: -6 },
});
