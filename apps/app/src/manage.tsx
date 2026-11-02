import {
    TITLE_MAX,
    lockedSettings,
    type EventSettingsPatch,
    type RevealMode,
    type Visibility,
} from "@linger/core/events";
import { TIERS, due, type TierId } from "@linger/core/pricing";
import { revealTime } from "@linger/core/reveal";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import {
    api,
    asApiError,
    invalidate,
    joinLink,
    uploadFile,
    useLoad,
    useSession,
    type Event,
    type EventSummary,
} from "@/api";
import {
    formatEnds,
    formatPrice,
    problem,
    revealModeLabel,
    revealWhen,
    t,
    visibilityLabel,
} from "@/copy";
import { refreshGallery } from "@/gallery";
import { InviteCard, PrintQr, canPrint, copyLink, factsOfSummary, useTableCards } from "@/invite";
import { purchase } from "@/purchase";
import {
    Button,
    Field,
    Icon,
    IconButton,
    Notice,
    Row,
    RowGroup,
    Sheet,
    Text,
    TierRow,
    color,
    confirm,
    divider,
    haptic,
    icons,
    radius,
    showToast,
    space,
} from "@/ui";

// The host's tools on the event screen: the guest count row under the actions and the Manage
// sheet behind the gear button. Both render nothing for guests.

export interface HostToolsProps {
    summary: EventSummary;
    /** Reloads the event screen's summary after a change. */
    onChanged: () => void;
}

/** The host's own event, with the id and settings the summary leaves out. */
function useOwnEvent(summary: EventSummary): Event | undefined {
    const session = useSession();
    const owner = summary.viewer.role === "host" && session;
    const events = useLoad(owner ? `host-events:${session.host.id}` : null, () =>
        api.events.list(),
    );
    return events.data?.find((event) => event.code === summary.code);
}

function changed({ onChanged }: HostToolsProps): void {
    invalidate("host-events:");
    onChanged();
}

/** Shows a line for 2 seconds after `show()`. */
function useBriefly(): [boolean, () => void] {
    const [on, setOn] = useState(0);
    useEffect(() => {
        if (on === 0) return;
        const id = setTimeout(() => setOn(0), 2000);
        return () => clearTimeout(id);
    }, [on]);
    return [on !== 0, () => setOn((n) => n + 1)];
}

// The host row

const MAKE_ROOM_AT = 0.8;

/** "7 of 10 guests" with a thin Candle bar and "Make room", under the event's actions. */
export function HostRow(props: HostToolsProps) {
    const { summary } = props;
    const [growing, setGrowing] = useState(false);
    const limit = summary.guestLimit;
    if (summary.viewer.role !== "host" || limit === null || summary.state === "draft") return null;

    const count = summary.guestCount;
    const filled = limit > 0 ? Math.min(1, count / limit) : 1;
    const open = summary.state === "live" || summary.state === "ended";
    const canGrow = open && filled >= MAKE_ROOM_AT && TIERS.some((tier) => tier.guests > limit);
    const line = t("guests.ofLimit", { count, limit });

    return (
        <View style={styles.hostRow}>
            <View style={styles.hostLine}>
                <Text variant="small" tone="ash">
                    {line}
                </Text>
                {canGrow ? (
                    <Pressable
                        onPress={() => setGrowing(true)}
                        accessibilityRole="button"
                        hitSlop={10}
                    >
                        <Text variant="small" weight="semibold">
                            {t("host.makeRoom")}
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            <View
                style={styles.track}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={line}
                accessibilityValue={{ min: 0, max: limit, now: count }}
            >
                <View style={[styles.fill, { width: `${filled * 100}%` }]} />
            </View>
            {canGrow ? (
                <MakeRoom
                    {...props}
                    limit={limit}
                    visible={growing}
                    onClose={() => setGrowing(false)}
                />
            ) : null}
        </View>
    );
}

/** The tiers above the event's limit, each priced by what the event still needs to buy. */
function MakeRoom({
    limit,
    visible,
    onClose,
    ...props
}: HostToolsProps & { limit: number; visible: boolean; onClose: () => void }) {
    const event = useOwnEvent(props.summary);
    const session = useSession();
    const tiers = TIERS.filter((tier) => tier.guests > limit);
    const [picked, setPicked] = useState<TierId | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const chosen = tiers.find((tier) => tier.id === picked) ?? tiers[0];
    const price = (id: TierId) =>
        formatPrice(due({ guestLimit: limit, unlimitedShots: false }, id, false).cents);

    const buy = async () => {
        if (!event || !session || !chosen) return;
        setBusy(true);
        setError(null);
        try {
            const result = await purchase({
                event,
                hostId: session.host.id,
                tier: chosen.id,
                unlimitedShots: false,
            });
            if (result.kind === "paid") {
                haptic("success");
                changed(props);
                onClose();
                showToast(t("host.roomMade", { count: result.event.guestLimit }));
            }
        } catch (e) {
            setError(problem(asApiError(e).code));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Sheet visible={visible} onClose={onClose}>
            <Text variant="heading" accessibilityRole="header">
                {t("host.makeRoom")}
            </Text>
            <Text variant="small" tone="ash">
                {t("create.guests.body")}
            </Text>
            <View style={{ gap: space.s }} accessibilityRole="radiogroup">
                {tiers.map((tier) => (
                    <TierRow
                        key={tier.id}
                        label={t("create.guests.tier", { count: tier.guests })}
                        price={price(tier.id)}
                        selected={tier.id === chosen?.id}
                        onPress={() => {
                            haptic("selection");
                            setPicked(tier.id);
                        }}
                    />
                ))}
            </View>
            {error ? <Notice>{error}</Notice> : null}
            {chosen ? (
                <Button
                    label={t("host.makeRoomFor", { price: price(chosen.id) })}
                    loading={busy}
                    disabled={!event}
                    onPress={() => {
                        buy().catch(() => null);
                    }}
                />
            ) : null}
        </Sheet>
    );
}

// The Manage sheet

/** The gear button in the event's action row, shown to the owner only. */
export function ManageButton(props: HostToolsProps) {
    const [open, setOpen] = useState(false);
    if (props.summary.viewer.role !== "host") return null;
    return (
        <>
            <IconButton
                icon={icons.settings}
                onPress={() => setOpen(true)}
                accessibilityLabel={t("host.manage")}
            />
            <ManageSheet {...props} visible={open} onClose={() => setOpen(false)} />
        </>
    );
}

type Page = "rows" | "name" | "ends" | "reveal" | "who" | "code";

const PRESETS: readonly Exclude<RevealMode, "custom">[] = ["right-away", "at-end", "next-morning"];
const FIVE_MINUTES = 5 * 60_000;

function ManageSheet(props: HostToolsProps & { visible: boolean; onClose: () => void }) {
    const { summary, visible, onClose } = props;
    const router = useRouter();
    const event = useOwnEvent(summary);
    const { height } = useWindowDimensions();
    const [page, setPage] = useState<Page>("rows");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, showSaved] = useBriefly();
    const [copied, showCopied] = useBriefly();
    const [name, setName] = useState("");
    const [ends, setEnds] = useState(new Date());
    const [endsFloor, setEndsFloor] = useState(0);
    const [customAt, setCustomAt] = useState<Date | null>(null);
    const cards = useTableCards(factsOfSummary(summary));

    const code = summary.code;
    const url = joinLink(code);
    const state = summary.state;
    const zone = summary.timeZone;

    const go = (next: Page) => {
        setError(null);
        setPage(next);
    };
    const close = () => {
        setPage("rows");
        setError(null);
        onClose();
    };

    const run = async (work: () => Promise<unknown>, after: () => void) => {
        setBusy(true);
        setError(null);
        try {
            await work();
            after();
        } catch (e) {
            setError(problem(asApiError(e).code));
        } finally {
            setBusy(false);
        }
    };

    const save = (patch: EventSettingsPatch) => {
        if (!event) return;
        if (lockedSettings(event, patch).length > 0) {
            setError(problem("locked"));
            return;
        }
        run(
            () => api.events.update(event.id, patch),
            () => {
                haptic("success");
                changed(props);
                showSaved();
                setPage("rows");
            },
        ).catch(() => null);
    };

    const pickCover = async () => {
        if (!event) return;
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.85,
        });
        const asset = result.canceled ? undefined : result.assets[0];
        if (!asset) return;
        const type = asset.mimeType ?? "image/jpeg";
        setBusy(true);
        setError(null);
        try {
            const { uploadUrl } = await api.events.cover(event.id, type);
            await uploadFile(uploadUrl, asset.uri, type);
            haptic("success");
            changed(props);
            showSaved();
        } catch {
            setError(t("create.name.coverFailed"));
        } finally {
            setBusy(false);
        }
    };

    const endNow = () => {
        if (!event) return;
        const now = new Date();
        const at = revealTime({ ...event.settings, endsAt: now.toISOString() });
        const when = revealWhen(now, at.getTime() > now.getTime() ? at : now, zone);
        confirm(t("manage.endTitle"), t("manage.endBody", { when }), t("manage.endNow"), () => {
            run(
                () => api.events.end(event.id),
                () => {
                    haptic("success");
                    changed(props);
                    // An event that reveals at once shows the moment as soon as the photos load.
                    refreshGallery(code).catch(() => null);
                    close();
                },
            ).catch(() => null);
        });
    };

    const remove = () => {
        if (!event) return;
        confirm(
            t("manage.deleteTitle", { title: summary.title }),
            t("manage.deleteBody"),
            t("manage.delete"),
            () => {
                run(
                    () => api.events.delete(event.id, code),
                    () => {
                        invalidate("host-events:");
                        close();
                        router.replace("/");
                    },
                ).catch(() => null);
            },
        );
    };

    const settings = event?.settings;
    const editable = state === "draft" || state === "live" || state === "ended";

    let body: ReactNode;
    if (page === "rows" || !event || !settings) {
        body = (
            <>
                <RowGroup>
                    {editable ? (
                        <Row
                            label={t("manage.name")}
                            note={summary.title}
                            disabled={!event}
                            onPress={() => {
                                setName(summary.title);
                                go("name");
                            }}
                        />
                    ) : null}
                    {state !== "archived" ? (
                        <Row
                            label={t("manage.cover")}
                            icon={icons.image}
                            disabled={!event || busy}
                            onPress={() => {
                                pickCover().catch(() => setError(t("create.name.coverFailed")));
                            }}
                        />
                    ) : null}
                    {state === "live" ? (
                        <Row
                            label={t("manage.ends")}
                            value={formatEnds(
                                new Date(summary.startsAt),
                                new Date(summary.endsAt),
                                zone,
                            )}
                            disabled={!event}
                            onPress={() => {
                                setEnds(new Date(summary.endsAt));
                                setEndsFloor(Date.now() + FIVE_MINUTES);
                                go("ends");
                            }}
                        />
                    ) : null}
                    {editable ? (
                        <Row
                            label={t("manage.reveal")}
                            value={revealModeLabel(summary.revealMode)}
                            disabled={!event}
                            onPress={() => {
                                setCustomAt(null);
                                go("reveal");
                            }}
                        />
                    ) : null}
                    {state !== "archived" ? (
                        <Row
                            label={t("manage.who")}
                            {...(settings ? { value: visibilityLabel(settings.visibility) } : {})}
                            disabled={!event}
                            onPress={() => go("who")}
                        />
                    ) : null}
                </RowGroup>
                <RowGroup>
                    <Row label={t("manage.showCode")} icon={icons.qr} onPress={() => go("code")} />
                    <Row
                        label={copied ? t("common.copied") : t("manage.copyLink")}
                        icon={copied ? icons.check : icons.share}
                        onPress={() => {
                            copyLink(url)
                                .then(() => {
                                    haptic("light");
                                    showCopied();
                                })
                                .catch(() => null);
                        }}
                    />
                    {canPrint ? (
                        <Row
                            label={t("manage.print")}
                            icon={icons.print}
                            disabled={cards.printing}
                            onPress={cards.print}
                        />
                    ) : null}
                </RowGroup>
                <RowGroup>
                    {state === "live" ? (
                        <Row
                            label={t("manage.endNow")}
                            icon={icons.close}
                            disabled={!event || busy}
                            onPress={endNow}
                        />
                    ) : null}
                    <Row
                        label={t("manage.delete")}
                        destructive
                        disabled={!event || busy}
                        onPress={remove}
                    />
                </RowGroup>
            </>
        );
    } else if (page === "name") {
        const trimmed = name.trim();
        body = (
            <>
                <Field
                    value={name}
                    onChangeText={setName}
                    maxLength={TITLE_MAX}
                    autoFocus
                    autoCapitalize="words"
                    multiline
                    submitBehavior="blurAndSubmit"
                    accessibilityLabel={t("manage.name")}
                />
                <Button
                    label={t("manage.save")}
                    loading={busy}
                    disabled={trimmed === "" || trimmed === settings.title}
                    onPress={() => save({ title: trimmed })}
                />
            </>
        );
    } else if (page === "ends") {
        const earliest = Math.max(endsFloor, Date.parse(settings.startsAt) + 3 * FIVE_MINUTES);
        const latest =
            settings.revealMode === "custom" && settings.revealAt
                ? new Date(settings.revealAt)
                : undefined;
        body = (
            <>
                <View style={{ alignItems: "center" }}>
                    <DateTimePicker
                        value={ends}
                        mode="datetime"
                        display="spinner"
                        minimumDate={new Date(earliest)}
                        {...(latest ? { maximumDate: latest } : {})}
                        themeVariant="dark"
                        accentColor={color.candle}
                        textColor={color.paper}
                        minuteInterval={5}
                        onValueChange={(_, date) => setEnds(date)}
                    />
                </View>
                <Button
                    label={t("manage.save")}
                    loading={busy}
                    onPress={() => {
                        if (ends.getTime() <= Date.now()) setError(problem("already-over"));
                        else save({ endsAt: ends.toISOString() });
                    }}
                />
            </>
        );
    } else if (page === "reveal") {
        const allowed = (patch: EventSettingsPatch) => lockedSettings(event, patch).length === 0;
        const earliest = new Date(
            Math.max(Date.parse(event.revealsAt), Date.parse(settings.endsAt)),
        );
        const custom = customAt ?? earliest;
        body = (
            <>
                <RowGroup>
                    {PRESETS.map((mode) => {
                        const ok = allowed({ revealMode: mode });
                        return (
                            <Choice
                                key={mode}
                                label={revealModeLabel(mode)}
                                selected={settings.revealMode === mode && customAt === null}
                                {...(ok ? {} : { note: t("manage.revealLocked") })}
                                onPress={() => {
                                    if (mode !== settings.revealMode) save({ revealMode: mode });
                                }}
                            />
                        );
                    })}
                    <Choice
                        label={t("create.rules.pickTime")}
                        selected={settings.revealMode === "custom" || customAt !== null}
                        onPress={() => setCustomAt(custom)}
                    />
                </RowGroup>
                {customAt !== null ? (
                    <>
                        <View style={{ alignItems: "center" }}>
                            <DateTimePicker
                                value={custom}
                                mode="datetime"
                                display="spinner"
                                minimumDate={
                                    state === "draft" ? new Date(settings.endsAt) : earliest
                                }
                                themeVariant="dark"
                                accentColor={color.candle}
                                textColor={color.paper}
                                minuteInterval={5}
                                onValueChange={(_, date) => setCustomAt(date)}
                            />
                        </View>
                        <Text variant="small" tone="ash" align="center">
                            {revealWhen(new Date(), custom, zone)}
                        </Text>
                        <Button
                            label={t("manage.save")}
                            loading={busy}
                            onPress={() =>
                                save({ revealMode: "custom", revealAt: custom.toISOString() })
                            }
                        />
                    </>
                ) : null}
            </>
        );
    } else if (page === "who") {
        const options: readonly Visibility[] = ["everyone", "host-only"];
        body = (
            <RowGroup>
                {options.map((visibility) => {
                    const ok = lockedSettings(event, { visibility }).length === 0;
                    return (
                        <Choice
                            key={visibility}
                            label={visibilityLabel(visibility)}
                            selected={settings.visibility === visibility}
                            {...(ok ? {} : { note: t("manage.whoLocked") })}
                            onPress={() => {
                                if (visibility !== settings.visibility) save({ visibility });
                            }}
                        />
                    );
                })}
            </RowGroup>
        );
    } else {
        body = (
            <InviteCard
                title={summary.title}
                url={url}
                code={code}
                caption={t("create.invite.scan")}
                size={200}
            />
        );
    }

    const titles: Record<Page, string> = {
        rows: t("manage.title"),
        name: t("manage.name"),
        ends: t("manage.ends"),
        reveal: t("manage.reveal"),
        who: t("manage.who"),
        code: t("manage.showCode"),
    };

    return (
        <Sheet visible={visible} onClose={close}>
            <View style={styles.head}>
                {page !== "rows" ? (
                    <IconButton
                        icon={icons.back}
                        onPress={() => go("rows")}
                        accessibilityLabel={t("common.back")}
                    />
                ) : null}
                <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
                    {titles[page]}
                </Text>
            </View>
            <ScrollView
                style={{ maxHeight: height * 0.62 }}
                contentContainerStyle={{ gap: space.m }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {body}
            </ScrollView>
            {error ? <Notice>{error}</Notice> : null}
            {saved ? (
                <View style={styles.saved} accessibilityLiveRegion="polite">
                    <Icon icon={icons.check} size={17} color={color.ash} />
                    <Text variant="small" tone="ash" accessibilityRole="alert">
                        {t("manage.saved")}
                    </Text>
                </View>
            ) : null}
            {visible && canPrint ? <PrintQr url={url} onRef={cards.setQr} /> : null}
        </Sheet>
    );
}

/** One option in a Manage list. A locked option reads its note and can't be chosen. */
function Choice({
    label,
    selected,
    note,
    onPress,
}: {
    label: string;
    selected: boolean;
    note?: string;
    onPress: () => void;
}) {
    const locked = note !== undefined;
    return (
        <Pressable
            onPress={onPress}
            disabled={locked}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: locked }}
            accessibilityLabel={[label, note].filter(Boolean).join(", ")}
            style={({ pressed }) => [styles.choice, { opacity: pressed ? 0.7 : 1 }]}
        >
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text tone={locked ? "faint" : "paper"}>{label}</Text>
                {note ? (
                    <Text variant="small" tone="ash">
                        {note}
                    </Text>
                ) : null}
            </View>
            {selected ? <Icon icon={icons.check} /> : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    hostRow: { paddingHorizontal: 12, paddingBottom: space.m, gap: space.s },
    hostLine: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        paddingHorizontal: space.xs,
    },
    track: {
        height: 3,
        borderRadius: radius.round,
        backgroundColor: color.track,
        overflow: "hidden",
    },
    fill: { height: 3, borderRadius: radius.round, backgroundColor: color.candle },
    head: { flexDirection: "row", alignItems: "center", gap: space.m },
    saved: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.xs,
    },
    choice: {
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        minHeight: 52,
        paddingVertical: space.m,
        ...divider,
    },
});
