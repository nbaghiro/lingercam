import { normalizeJoinCode } from "@linger/core/events";
import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { FlatList, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, asApiError, useLoad, type Person } from "@/api";
import { deviceZone, formatCount, formatTime, problem, t } from "@/copy";
import { forgetGallery } from "@/gallery";
import {
    IconButton,
    Text,
    color,
    confirm,
    divider,
    gutter,
    icons,
    haptic,
    hashSource,
    photoSource,
    showToast,
    space,
} from "@/ui";

// The people sheet. A list of 250 guests is virtualised, so only the rows on screen are drawn.

const ROW_HEIGHT = 75;

export function People({
    visible,
    onClose,
    people,
    items,
    revealed,
    removeFrom,
    onRemoved,
    onPick,
}: {
    visible: boolean;
    onClose: () => void;
    people: Person[];
    items: GalleryItem[];
    revealed: boolean;
    /** The host's event id: guests can then be removed with a long press. */
    removeFrom?: string | undefined;
    onRemoved?: () => void;
    onPick: (person: Person) => void;
}) {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ code: string }>();
    const code = normalizeJoinCode(params.code ?? "") ?? params.code ?? "";
    const summary = useLoad(code ? `summary:${code}` : null, () => api.guest.summary(code));
    const limit = summary.data?.guestLimit ?? null;

    const remove = removeFrom
        ? (person: Person) => {
              confirm(
                  t("photo.removeGuestTitle", { name: person.name }),
                  t("photo.removeGuestBody"),
                  t("photo.removeGuest", { name: person.name }),
                  () => {
                      api.events
                          .removeGuest(removeFrom, person.id)
                          .then(() => {
                              // The row going is the confirmation: a toast would sit under the sheet.
                              haptic("success");
                              forgetGallery(code);
                              onRemoved?.();
                          })
                          .catch((error: unknown) => showToast(problem(asApiError(error).code)));
                  },
              );
          }
        : undefined;

    const faces = new Map<string, GalleryItem>();
    for (const item of items) {
        if (!faces.has(item.photographer.id)) faces.set(item.photographer.id, item);
    }

    const header = (
        <View style={styles.header}>
            <Text variant="title" accessibilityRole="header">
                {t("people.title", { count: people.length })}
            </Text>
            {limit !== null && summary.data ? (
                <Text variant="small" tone="ash" style={styles.line}>
                    {t("guests.ofLimit", { count: summary.data.guestCount, limit })}
                </Text>
            ) : null}
            <Text variant="small" tone="ash" style={styles.line}>
                {revealed ? t("people.body") : t("people.bodyBefore")}
            </Text>
            {removeFrom ? (
                <Text variant="small" tone="ash" style={styles.line}>
                    {t("people.removeHint")}
                </Text>
            ) : null}
        </View>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
            onRequestClose={onClose}
        >
            <View
                style={[
                    styles.screen,
                    { paddingTop: Platform.OS === "ios" ? 18 : insets.top + space.m },
                ]}
            >
                <View style={styles.top}>
                    <IconButton
                        icon={icons.close}
                        onPress={onClose}
                        accessibilityLabel={t("common.close")}
                    />
                </View>
                <FlatList
                    data={people}
                    keyExtractor={(person) => person.id}
                    ListHeaderComponent={header}
                    initialNumToRender={14}
                    windowSize={7}
                    contentContainerStyle={{
                        paddingHorizontal: gutter,
                        paddingBottom: insets.bottom + space.xl,
                    }}
                    renderItem={({ item: person }) => (
                        <PersonRow
                            person={person}
                            face={faces.get(person.id)}
                            canOpen={revealed && person.shots > 0}
                            onRemove={person.host ? undefined : remove}
                            onPick={onPick}
                        />
                    )}
                />
            </View>
        </Modal>
    );
}

function PersonRow({
    person,
    face,
    canOpen,
    onRemove,
    onPick,
}: {
    person: Person;
    face: GalleryItem | undefined;
    canOpen: boolean;
    onRemove: ((person: Person) => void) | undefined;
    onPick: (person: Person) => void;
}) {
    const second = person.host
        ? t("people.host")
        : t("people.joined", { time: formatTime(new Date(person.joinedAt), deviceZone()) });
    const shots = t("people.shots", { count: person.shots });
    return (
        <Pressable
            onPress={canOpen ? () => onPick(person) : undefined}
            onLongPress={onRemove ? () => onRemove(person) : undefined}
            disabled={!canOpen && !onRemove}
            accessibilityRole={canOpen ? "button" : "text"}
            accessibilityLabel={`${person.name}, ${second}, ${shots}`}
            accessibilityActions={
                onRemove
                    ? [{ name: "remove", label: t("photo.removeGuest", { name: person.name }) }]
                    : undefined
            }
            onAccessibilityAction={() => onRemove?.(person)}
            style={({ pressed }) => [styles.person, { opacity: pressed ? 0.7 : 1 }]}
        >
            {face ? (
                <Image
                    source={photoSource(face.thumbUrl, face.id, "thumb")}
                    placeholder={hashSource(face.placeholder)}
                    style={styles.face}
                    contentFit="cover"
                />
            ) : (
                <View style={[styles.face, styles.initial]}>
                    <Text serif variant="name">
                        {person.name.slice(0, 1).toUpperCase()}
                    </Text>
                </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text weight="medium" numberOfLines={1}>
                    {person.name}
                </Text>
                <Text variant="small" tone="ash" style={styles.second} numberOfLines={1}>
                    {second}
                </Text>
            </View>
            <Text serif italic style={styles.shots}>
                {formatCount(person.shots)}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    top: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: space.l },
    header: { paddingBottom: space.m },
    line: { marginTop: 6 },
    person: {
        height: ROW_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        ...divider,
    },
    face: { width: 50, height: 50, borderRadius: 25, backgroundColor: color.raised },
    initial: { alignItems: "center", justifyContent: "center" },
    second: { fontSize: 14, lineHeight: 19 },
    shots: { fontSize: 23, lineHeight: 28, color: "#E2DFD8" },
});
