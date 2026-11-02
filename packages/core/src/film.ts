export const LOOK_IDS = ["natural@1", "warm-98@1", "mono@1"] as const;
export type LookId = (typeof LOOK_IDS)[number];

export interface Look {
    id: LookId;
    name: string;
    description: string;
    /** Row-major 4x5 colour matrix on unpremultiplied RGBA in 0..1; the fifth column is an offset. */
    matrix: readonly number[];
    grain: number;
    vignette: number;
    halation: number;
    warmth: number;
}

// prettier-ignore
const IDENTITY = [
    1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,
    0, 0, 0, 1, 0,
];

// Sepia 0.28, saturate 1.15, contrast 1.06 and brightness 1.02, composed into one matrix.
// prettier-ignore
const WARM = [
    0.9912, 0.1528, 0.0497, 0, -0.0306,
    0.0806, 1.0191, 0.0424, 0, -0.0306,
    0.0538, 0.071, 0.9247, 0, -0.0306,
    0, 0, 0, 1, 0,
];

// Rec. 709 luminance with contrast 1.15 around mid grey.
// prettier-ignore
const MONO = [
    0.2445, 0.8225, 0.083, 0, -0.075,
    0.2445, 0.8225, 0.083, 0, -0.075,
    0.2445, 0.8225, 0.083, 0, -0.075,
    0, 0, 0, 1, 0,
];

export const LOOKS: Record<LookId, Look> = {
    "natural@1": {
        id: "natural@1",
        name: "Natural",
        description: "As shot",
        matrix: IDENTITY,
        grain: 0,
        vignette: 0,
        halation: 0,
        warmth: 0,
    },
    "warm-98@1": {
        id: "warm-98@1",
        name: "Warm '98",
        description: "Soft grain, warm flash",
        matrix: WARM,
        grain: 0.07,
        vignette: 0.28,
        halation: 0.2,
        warmth: 0.35,
    },
    "mono@1": {
        id: "mono@1",
        name: "Mono",
        description: "Silver, high contrast",
        matrix: MONO,
        grain: 0.09,
        vignette: 0.32,
        halation: 0,
        warmth: 0,
    },
};

export const DEFAULT_LOOK: LookId = "warm-98@1";

export interface LookUniforms {
    resolution: [number, number];
    colorMatrix: number[];
    colorOffset: [number, number, number, number];
    grain: number;
    vignette: number;
    halation: number;
    warmth: number;
    seed: number;
}

/**
 * Uniforms for FILM_SHADER. `colorMatrix` is column-major, the order SkSL reads a float4x4 in,
 * so the app and the server pass the same values. `seed` varies the grain between photos.
 */
export function lookUniforms(id: LookId, width: number, height: number, seed = 0): LookUniforms {
    const look = LOOKS[id];
    const m = look.matrix;
    const at = (row: number, col: number): number => m[row * 5 + col] ?? 0;
    const colorMatrix: number[] = [];
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) colorMatrix.push(at(row, col));
    }
    return {
        resolution: [width, height],
        colorMatrix,
        colorOffset: [at(0, 4), at(1, 4), at(2, 4), at(3, 4)],
        grain: look.grain,
        vignette: look.vignette,
        halation: look.halation,
        warmth: look.warmth,
        seed,
    };
}

/** One SkSL runtime effect for every look. The child shader `image` is the photo. */
export const FILM_SHADER = `uniform shader image;
uniform float2 resolution;
uniform float4x4 colorMatrix;
uniform float4 colorOffset;
uniform float grain;
uniform float vignette;
uniform float halation;
uniform float warmth;
uniform float seed;

float hash(float2 p) {
    p = fract(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float luma(float3 c) {
    return dot(c, float3(0.2126, 0.7152, 0.0722));
}

half4 main(float2 xy) {
    float4 c = float4(image.eval(xy));
    if (c.a > 0.0) {
        c.rgb /= c.a;
    }

    if (halation > 0.0) {
        float radius = max(resolution.x, resolution.y) * 0.006;
        float glow = 0.0;
        for (int i = 0; i < 8; i++) {
            float angle = float(i) * 0.785398;
            float2 offset = float2(cos(angle), sin(angle)) * radius;
            float4 s = float4(image.eval(xy + offset));
            glow += smoothstep(0.7, 1.0, luma(s.rgb));
        }
        glow /= 8.0;
        c.rgb += float3(1.0, 0.45, 0.25) * glow * halation * 0.5;
    }

    c = colorMatrix * c + colorOffset;

    c.r += warmth * 0.05;
    c.b -= warmth * 0.05;

    float2 uv = xy / resolution;
    float d = distance(uv, float2(0.5)) * 1.41421;
    c.rgb *= 1.0 - vignette * smoothstep(0.35, 1.0, d);

    if (grain > 0.0) {
        float n = hash(xy + seed) - 0.5;
        float l = luma(c.rgb);
        c.rgb += n * grain * (1.0 - abs(l - 0.5) * 1.2);
    }

    c = clamp(c, 0.0, 1.0);
    return half4(c.rgb * c.a, c.a);
}
`;

/** The uniforms as one flat list in declaration order, for CanvasKit's makeShaderWithChildren. */
export function flatUniforms(u: LookUniforms): number[] {
    return [
        ...u.resolution,
        ...u.colorMatrix,
        ...u.colorOffset,
        u.grain,
        u.vignette,
        u.halation,
        u.warmth,
        u.seed,
    ];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/**
 * FILM_SHADER over raw RGB pixels, step for step: halation, colour matrix, warmth, vignette and
 * grain. The server develops with this because CanvasKit on the CPU took 7 to 11 s per 2048 px
 * photo; this takes about 0.1 s. film.test.ts checks it against the shader. Only the grain differs
 * on purpose: a seeded LCG in place of the shader's hash.
 */
export function applyLook(
    pixels: Uint8Array,
    width: number,
    height: number,
    look: Look,
    seed: number,
): Uint8Array {
    const m = look.matrix;
    const n = width * height;
    const out = new Uint8Array(n * 3);

    let glow: Float32Array | null = null;
    if (look.halation > 0) {
        const highlight = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const j = i * 3;
            const l =
                (0.2126 * pixels[j]! + 0.7152 * pixels[j + 1]! + 0.0722 * pixels[j + 2]!) / 255;
            highlight[i] = smoothstep(0.7, 1, l);
        }
        const radius = Math.max(width, height) * 0.006;
        const offsets: [number, number][] = [];
        for (let k = 0; k < 8; k++) {
            const angle = k * 0.785398;
            offsets.push([
                Math.floor(0.5 + Math.cos(angle) * radius),
                Math.floor(0.5 + Math.sin(angle) * radius),
            ]);
        }
        glow = new Float32Array(n);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let g = 0;
                for (const [dx, dy] of offsets) {
                    const xx = Math.min(width - 1, Math.max(0, x + dx));
                    const yy = Math.min(height - 1, Math.max(0, y + dy));
                    g += highlight[yy * width + xx]!;
                }
                glow[y * width + x] = g / 8;
            }
        }
    }

    let state = seed >>> 0 || 1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const j = i * 3;
            let r = pixels[j]! / 255;
            let g = pixels[j + 1]! / 255;
            let b = pixels[j + 2]! / 255;
            if (glow) {
                const h = glow[i]! * look.halation * 0.5;
                r += h;
                g += 0.45 * h;
                b += 0.25 * h;
            }
            let R = m[0]! * r + m[1]! * g + m[2]! * b + m[4]!;
            let G = m[5]! * r + m[6]! * g + m[7]! * b + m[9]!;
            let B = m[10]! * r + m[11]! * g + m[12]! * b + m[14]!;
            R += look.warmth * 0.05;
            B -= look.warmth * 0.05;
            // Pixel centres, as the shader sees them.
            const dx = (x + 0.5) / width - 0.5;
            const dy = (y + 0.5) / height - 0.5;
            const v =
                1 - look.vignette * smoothstep(0.35, 1, Math.sqrt(dx * dx + dy * dy) * 1.41421);
            R *= v;
            G *= v;
            B *= v;
            if (look.grain > 0) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                const noise = state / 4294967296 - 0.5;
                const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
                const grain = noise * look.grain * (1 - Math.abs(l - 0.5) * 1.2);
                R += grain;
                G += grain;
                B += grain;
            }
            out[j] = Math.round(Math.min(1, Math.max(0, R)) * 255);
            out[j + 1] = Math.round(Math.min(1, Math.max(0, G)) * 255);
            out[j + 2] = Math.round(Math.min(1, Math.max(0, B)) * 255);
        }
    }
    return out;
}
