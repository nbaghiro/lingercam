import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Person } from "@/api";
import { formatCount, formatTime, t } from "@/copy";
import { IconButton, Text, color, gutter, icons } from "@/ui";

// The people sheet

export function People({
    visible,
    onClose,
    people,
    items,
    revealed,
    timeZone,
    onPick,
}: {
    visible: boolean;
    onClose: () => void;
    people: Person[];
    items: GalleryItem[];
    revealed: boolean;
    timeZone: string;
    onPick: (person: Person) => void;
}) {
    const insets = useSafeAreaInsets();
    const faces = new Map<string, string>();
    for (const item of items) {
        if (!faces.has(item.photographer.id)) faces.set(item.photographer.id, item.thumbUrl);
    }
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
                    { paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 },
                ]}
            >
                <View style={styles.peopleTop}>
                    <IconButton
                        icon={icons.close}
                        onPress={onClose}
                        accessibilityLabel={t("common.close")}
                    />
                </View>
                <ScrollView
                    contentContainerStyle={{
                        paddingHorizontal: gutter,
                        paddingBottom: insets.bottom + 24,
                    }}
                >
                    <Text variant="title" accessibilityRole="header">
                        {t("people.title", { count: people.length })}
                    </Text>
                    <Text variant="small" tone="ash" style={{ marginTop: 6 }}>
                        {revealed ? t("people.body") : t("people.bodyBefore")}
                    </Text>
                    <View style={{ marginTop: 14 }}>
                        {people.map((person) => {
                            const face = faces.get(person.id);
                            return (
                                <Pressable
                                    key={person.id}
                                    onPress={() => onPick(person)}
                                    disabled={!revealed || !face}
                                    accessibilityRole={revealed && face ? "button" : "text"}
                                    accessibilityLabel={`${person.name}, ${t("people.shots", {
                                        count: person.shots,
                                    })}`}
                                    style={({ pressed }) => [
                                        styles.person,
                                        { opacity: pressed ? 0.7 : 1 },
                                    ]}
                                >
                                    {face ? (
                                        <Image
                                            source={face}
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
                                        <Text variant="small" tone="ash" style={styles.joined}>
                                            {t("people.joined", {
                                                time: formatTime(
                                                    new Date(person.joinedAt),
                                                    timeZone,
                                                ),
                                            })}
                                        </Text>
                                    </View>
                                    <Text serif italic style={styles.shots}>
                                        {formatCount(person.shots)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </ScrollView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    peopleTop: { flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16 },
    person: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth * 2,
        borderBottomColor: color.line,
    },
    face: { width: 50, height: 50, borderRadius: 25, backgroundColor: color.raised },
    initial: { alignItems: "center", justifyContent: "center" },
    joined: { fontSize: 14, lineHeight: 19 },
    shots: { fontSize: 23, lineHeight: 28, color: "#E2DFD8" },
});
