import { FILM_SHADER, lookUniforms, type LookId } from "@linger/core/film";
import { Canvas, Fill, ImageShader, Shader, Skia, useImage } from "@shopify/react-native-skia";
import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

const effect = Skia.RuntimeEffect.Make(FILM_SHADER);

export interface LookImageProps {
    /** A bundled image (`require`) or a URL. */
    source: number | string;
    look: LookId;
    style?: StyleProp<ViewStyle>;
}

/** A photo drawn through the film shader from core, the same one the server develops with. */
export function LookImage({ source, look, style }: LookImageProps) {
    const image = useImage(source);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const { width, height } = size;
    return (
        <View
            style={[{ overflow: "hidden" }, style]}
            onLayout={(e) => setSize(e.nativeEvent.layout)}
            accessibilityIgnoresInvertColors
        >
            {image && effect && width > 0 ? (
                <Canvas style={StyleSheet.absoluteFill}>
                    <Fill>
                        <Shader source={effect} uniforms={{ ...lookUniforms(look, width, height) }}>
                            <ImageShader
                                image={image}
                                fit="cover"
                                rect={{ x: 0, y: 0, width, height }}
                            />
                        </Shader>
                    </Fill>
                </Canvas>
            ) : null}
        </View>
    );
}
