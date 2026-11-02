import { LOOKS, type Look, type LookId } from "@linger/core/film";
import { Image } from "expo-image";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

// The browser has no Skia runtime loaded, so each look is rebuilt from core's own parameters: the
// colour matrix and warmth as an SVG feColorMatrix, and the vignette as a radial gradient laid
// over the picture (black at the shader's strength darkens by exactly that factor). Grain and
// halation are left out; the developed photo has them.

const FILTER_ID = (id: LookId) => `linger-look-${id.replace(/[^a-z0-9]/g, "-")}`;

/** The look's 4x5 matrix with warmth folded into the offsets, as feColorMatrix reads it. */
export function lookMatrix(look: Look): number[] {
    const m = [...look.matrix];
    m[4] = (m[4] ?? 0) + look.warmth * 0.05;
    m[14] = (m[14] ?? 0) - look.warmth * 0.05;
    return m;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * The shader's vignette as a CSS gradient. `farthest-corner` puts 100% at the corners, which is
 * where the shader's distance reaches 1.
 */
export function lookVignette(look: Look): string | null {
    if (look.vignette <= 0) return null;
    const stops: string[] = [];
    for (let i = 0; i <= 10; i++) {
        const d = 0.35 + (0.65 * i) / 10;
        const alpha = look.vignette * smoothstep(0.35, 1, d);
        stops.push(`rgba(0, 0, 0, ${alpha.toFixed(4)}) ${(d * 100).toFixed(1)}%`);
    }
    return `radial-gradient(ellipse farthest-corner at center, rgba(0, 0, 0, 0) 0%, ${stops.join(", ")})`;
}

let installed = false;

function installFilters(): void {
    if (installed || typeof document === "undefined") return;
    installed = true;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.position = "absolute";
    for (const look of Object.values(LOOKS)) {
        const filter = document.createElementNS(ns, "filter");
        filter.setAttribute("id", FILTER_ID(look.id));
        filter.setAttribute("color-interpolation-filters", "sRGB");
        const matrix = document.createElementNS(ns, "feColorMatrix");
        matrix.setAttribute("type", "matrix");
        matrix.setAttribute("values", lookMatrix(look).join(" "));
        filter.appendChild(matrix);
        svg.appendChild(filter);
    }
    document.body.appendChild(svg);
}

/** The CSS `filter` for a look, for a <video> or an image. */
export function lookFilter(id: LookId): string {
    if (id === "natural@1") return "none";
    installFilters();
    return `url(#${FILTER_ID(id)})`;
}

/** The vignette over a picture drawn with `lookFilter`. */
export function LookVignette({ look }: { look: LookId }) {
    const gradient = lookVignette(LOOKS[look]);
    if (!gradient) return null;
    return (
        <div
            aria-hidden
            style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                backgroundImage: gradient,
            }}
        />
    );
}

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
                style={[StyleSheet.absoluteFill, { filter: lookFilter(look) }]}
            />
            <LookVignette look={look} />
        </View>
    );
}
