import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
    Easing,
    FadeIn,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

import { t } from "@/copy";
import { Button, Screen, Text, color } from "@/ui";

// The reveal moment: three photos fanned out, shown once on each device.

function FanCard({ uri, index, open }: { uri: string; index: number; open: SharedValue<number> }) {
    const side = index - 1;
    const style = useAnimatedStyle(() => ({
        transform: [
            { translateX: side * (26 + 66 * open.value) },
            { translateY: Math.abs(side) * 18 * open.value },
            { rotate: `${side * (5 + 6 * open.value)}deg` },
        ],
    }));
    return (
        <Animated.View style={[styles.fanCard, style]}>
            <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" />
        </Animated.View>
    );
}

export function Moment({
    items,
    total,
    photographers,
    onDone,
}: {
    items: GalleryItem[];
    total: number;
    photographers: number;
    onDone: () => void;
}) {
    const open = useSharedValue(0);
    const [opening, setOpening] = useState(false);
    const cards = [items[2], items[1], items[0]].filter((item) => item !== undefined);

    const reveal = () => {
        if (opening) return;
        setOpening(true);
        open.set(withTiming(1, { duration: 900, easing: Easing.bezier(0.2, 0.9, 0.3, 1.15) }));
        setTimeout(onDone, 1300);
    };

    return (
        <Screen footer={<Button label={t("moment.cta")} onPress={reveal} />}>
            <Animated.View entering={FadeIn.duration(500)} style={{ alignItems: "center" }}>
                <Text variant="display" align="center" style={{ marginTop: 20 }}>
                    {t("moment.title")}
                </Text>
                <Text variant="small" tone="ash" align="center" style={{ marginTop: 10 }}>
                    {t("moment.body", { moments: total, people: photographers })}
                </Text>
            </Animated.View>
            <View style={styles.fan}>
                {cards.map((item, i) => (
                    <FanCard
                        key={item.id}
                        uri={item.thumbUrl}
                        index={cards.length === 3 ? i : i + (3 - cards.length) / 2}
                        open={open}
                    />
                ))}
            </View>
        </Screen>
    );
}

const styles = StyleSheet.create({
    fan: { height: 420, marginTop: 24, marginBottom: 10 },
    fanCard: {
        position: "absolute",
        left: "50%",
        top: 30,
        width: 210,
        marginLeft: -105,
        aspectRatio: 3 / 4,
        borderRadius: 18,
        overflow: "hidden",
        backgroundColor: color.tile,
        shadowColor: "#000",
        shadowOpacity: 0.6,
        shadowRadius: 25,
        shadowOffset: { width: 0, height: 24 },
        elevation: 12,
    },
});
