import type { GalleryItem } from "@linger/core/shots";
import { Image } from "expo-image";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
    Easing,
    FadeIn,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/copy";
import { Button, Text, color, gutter, haptic, photoSource, useReduceMotion } from "@/ui";

// The reveal moment: three photos fanned out, shown once on each device. It sits over the
// revealed grid; on "See every moment" the fan opens, then the cards settle into the first tiles
// while the moment fades and the grid comes up beneath it.

const CARD_WIDTH = 210;
const CARD_HEIGHT = (CARD_WIDTH * 4) / 3;
const CARD_TOP = 30;
const FAN_MS = 900;
const SETTLE_MS = 500;

/** Where a grid tile sits on screen, in window points. */
export interface TileTarget {
    x: number;
    y: number;
    width: number;
}

/** The top left of the fan's cards before they move, in window points. */
interface Origin {
    x: number;
    y: number;
}

function FanCard({
    item,
    front,
    side,
    open,
    settle,
    origin,
    target,
}: {
    item: GalleryItem;
    front: boolean;
    side: number;
    open: SharedValue<number>;
    settle: SharedValue<number>;
    origin: Origin | null;
    target: TileTarget | undefined;
}) {
    // The centre of the card before it moves, and how far it travels to the tile's centre.
    const dx =
        origin && target ? target.x + target.width / 2 - (origin.x + CARD_WIDTH / 2) : side * 92;
    const dy =
        origin && target
            ? target.y + (target.width * 4) / 3 / 2 - (origin.y + CARD_TOP + CARD_HEIGHT / 2)
            : 0;
    const scale = target ? target.width / CARD_WIDTH : 1;
    const style = useAnimatedStyle(() => {
        const fanX = side * (26 + 66 * open.value);
        const fanY = Math.abs(side) * 18 * open.value;
        const fanR = side * (5 + 6 * open.value);
        const s = settle.value;
        return {
            opacity: target ? 1 : interpolate(s, [0, 1], [1, 0]),
            transform: [
                { translateX: fanX + (dx - fanX) * s },
                { translateY: fanY + (dy - fanY) * s },
                { scale: 1 + (scale - 1) * s },
                { rotate: `${fanR * (1 - s)}deg` },
            ],
        };
    });
    // The front card is the one people look at, so it's the developed photo, not the thumbnail.
    const source = front
        ? photoSource(item.url, item.id, "full")
        : photoSource(item.thumbUrl, item.id, "thumb");
    return (
        <Animated.View style={[styles.fanCard, style]}>
            <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" />
        </Animated.View>
    );
}

export interface MomentProps {
    /** The server's three highlights, oldest first. */
    items: GalleryItem[];
    total: number;
    photographers: number;
    /** The viewer's own photos that have arrived; 0 hides the personal line. */
    mine: number;
    /** The first grid tiles, for the cards to settle into. */
    targets: readonly TileTarget[];
    onDone: () => void;
}

export function Moment({ items, total, photographers, mine, targets, onDone }: MomentProps) {
    const insets = useSafeAreaInsets();
    const reduceMotion = useReduceMotion();
    const open = useSharedValue(0);
    const settle = useSharedValue(0);
    const fade = useSharedValue(1);
    const [opening, setOpening] = useState(false);
    const [origin, setOrigin] = useState<Origin | null>(null);
    const fanRef = useRef<ComponentRef<typeof View>>(null);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        const pending = timers.current;
        return () => {
            for (const timer of pending) clearTimeout(timer);
        };
    }, []);

    // Drawn back to front: the last card is on top.
    const cards = [items[2], items[1], items[0]].filter((item) => item !== undefined);

    const reveal = () => {
        if (opening) return;
        setOpening(true);
        haptic("success");
        if (reduceMotion) {
            fade.set(withTiming(0, { duration: SETTLE_MS }));
            timers.current.push(setTimeout(onDone, SETTLE_MS));
            return;
        }
        open.set(withTiming(1, { duration: FAN_MS, easing: Easing.bezier(0.2, 0.9, 0.3, 1.15) }));
        timers.current.push(
            setTimeout(() => {
                const timing = { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) };
                settle.set(withTiming(1, timing));
                fade.set(withTiming(0, timing));
            }, FAN_MS + 100),
            setTimeout(onDone, FAN_MS + 100 + SETTLE_MS),
        );
    };

    const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }));
    const all = useAnimatedStyle(() => ({ opacity: reduceMotion ? fade.value : 1 }));

    return (
        <Animated.View style={[StyleSheet.absoluteFill, all]}>
            <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]} />
            <View style={[styles.content, { paddingTop: insets.top + 12 }]}>
                <Animated.View style={backdrop}>
                    <Animated.View entering={FadeIn.duration(500)} style={styles.heading}>
                        <Text
                            variant="display"
                            align="center"
                            accessibilityRole="header"
                            style={{ marginTop: 20 }}
                        >
                            {t("moment.title")}
                        </Text>
                        <Text variant="small" tone="ash" align="center" style={{ marginTop: 10 }}>
                            {t("moment.body", { moments: total, people: photographers })}
                        </Text>
                        {mine > 0 ? (
                            <Text
                                variant="small"
                                tone="ash"
                                align="center"
                                serif
                                italic
                                style={{ marginTop: 4 }}
                            >
                                {t("moment.yours", { count: mine })}
                            </Text>
                        ) : null}
                    </Animated.View>
                </Animated.View>
                <View
                    ref={fanRef}
                    style={styles.fan}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    onLayout={() =>
                        fanRef.current?.measureInWindow((x, y, width) =>
                            setOrigin({ x: x + width / 2 - CARD_WIDTH / 2, y }),
                        )
                    }
                >
                    {cards.map((item, i) => {
                        const index = cards.length === 3 ? i : i + (3 - cards.length) / 2;
                        return (
                            <FanCard
                                key={item.id}
                                item={item}
                                front={i === cards.length - 1}
                                side={index - 1}
                                open={open}
                                settle={settle}
                                origin={origin}
                                target={targets[cards.length - 1 - i]}
                            />
                        );
                    })}
                </View>
            </View>
            <Animated.View
                style={[
                    { paddingHorizontal: gutter, paddingBottom: Math.max(insets.bottom, 12) + 10 },
                    backdrop,
                ]}
            >
                <Button label={t("moment.cta")} onPress={reveal} disabled={opening} />
            </Animated.View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    backdrop: { backgroundColor: color.night },
    content: { flex: 1, paddingHorizontal: gutter },
    heading: { alignItems: "center" },
    fan: { height: 420, marginTop: 24, marginBottom: 10 },
    fanCard: {
        position: "absolute",
        left: "50%",
        top: CARD_TOP,
        width: CARD_WIDTH,
        marginLeft: -CARD_WIDTH / 2,
        height: CARD_HEIGHT,
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
