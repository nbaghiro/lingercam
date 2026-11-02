import type { LookId } from "@linger/core/film";
import { Image } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

// The browser has no Skia runtime loaded, so the looks are approximated with CSS filters.
export const LOOK_FILTERS: Record<LookId, string> = {
    "natural@1": "none",
    "warm-98@1": "sepia(0.28) saturate(1.15) contrast(1.06) brightness(1.02)",
    "mono@1": "grayscale(1) contrast(1.15)",
};

export interface LookImageProps {
    source: number | string;
    look: LookId;
    style?: StyleProp<ViewStyle>;
}

export function LookImage({ source, look, style }: LookImageProps) {
    return (
        <View style={[{ overflow: "hidden" }, style]}>
            <Image
                source={source}
                contentFit="cover"
                style={[StyleSheet.absoluteFill, { filter: LOOK_FILTERS[look] }]}
            />
        </View>
    );
}
