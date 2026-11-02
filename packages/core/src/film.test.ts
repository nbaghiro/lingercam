import CanvasKitInit, { type CanvasKit } from "canvaskit-wasm";
import { beforeAll, describe, expect, test } from "vitest";
import {
    DEFAULT_LOOK,
    FILM_SHADER,
    LOOK_IDS,
    LOOKS,
    applyLook,
    flatUniforms,
    lookUniforms,
    type LookId,
} from "./film.ts";

describe("looks", () => {
    test("ids are versioned and stable", () => {
        expect(LOOK_IDS).toEqual(["natural@1", "warm-98@1", "mono@1"]);
        for (const id of LOOK_IDS) {
            expect(LOOKS[id].id).toBe(id);
            expect(id).toMatch(/^[a-z0-9-]+@\d+$/);
        }
    });

    test("names and descriptions match the design", () => {
        expect(LOOKS["natural@1"]).toMatchObject({
            name: "Natural",
            description: "As shot",
        });
        expect(LOOKS["warm-98@1"]).toMatchObject({
            name: "Warm '98",
            description: "Soft grain, warm flash",
        });
        expect(LOOKS["mono@1"]).toMatchObject({
            name: "Mono",
            description: "Silver, high contrast",
        });
    });

    test("every look has a 4x5 matrix and parameters in range", () => {
        for (const id of LOOK_IDS) {
            const look = LOOKS[id];
            expect(look.matrix).toHaveLength(20);
            for (const v of [look.grain, look.vignette, look.halation, look.warmth]) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
            expect(look.matrix.slice(15)).toEqual([0, 0, 0, 1, 0]);
        }
    });

    test("natural is the identity with no effects", () => {
        const n = LOOKS["natural@1"];
        expect(n.matrix).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
        expect([n.grain, n.vignette, n.halation, n.warmth]).toEqual([0, 0, 0, 0]);
    });

    test("the default", () => {
        expect(DEFAULT_LOOK).toBe("warm-98@1");
    });
});

describe("lookUniforms", () => {
    test("transposes the matrix to column-major and splits the offset", () => {
        const u = lookUniforms("warm-98@1", 400, 300, 7);
        const m = LOOKS["warm-98@1"].matrix;
        expect(u.resolution).toEqual([400, 300]);
        expect(u.seed).toBe(7);
        expect(u.colorMatrix).toHaveLength(16);
        // Column 0 holds each row's red coefficient.
        expect(u.colorMatrix.slice(0, 4)).toEqual([m[0], m[5], m[10], m[15]]);
        expect(u.colorOffset).toEqual([m[4], m[9], m[14], m[19]]);
    });

    test("flatUniforms follows the shader's declaration order", () => {
        const u = lookUniforms("mono@1", 10, 20, 3);
        const flat = flatUniforms(u);
        expect(flat).toHaveLength(27);
        expect(flat.slice(0, 2)).toEqual([10, 20]);
        expect(flat.at(-1)).toBe(3);
    });
});

describe("FILM_SHADER", () => {
    let ck: CanvasKit;

    beforeAll(async () => {
        ck = await CanvasKitInit();
    });

    function develop(id: LookId, rgba: [number, number, number]): [number, number, number] {
        const size = 32;
        const errors: string[] = [];
        const effect = ck.RuntimeEffect.Make(FILM_SHADER, (e) => errors.push(e));
        if (!effect) throw new Error(errors.join("\n"));
        const pixels = new Uint8Array(size * size * 4);
        for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgba, 255], i);
        const info = {
            width: size,
            height: size,
            colorType: ck.ColorType.RGBA_8888,
            alphaType: ck.AlphaType.Unpremul,
            colorSpace: ck.ColorSpace.SRGB,
        };
        const image = ck.MakeImage(info, pixels, size * 4);
        if (!image) throw new Error("image");
        const child = image.makeShaderOptions(
            ck.TileMode.Clamp,
            ck.TileMode.Clamp,
            ck.FilterMode.Nearest,
            ck.MipmapMode.None,
        );
        const shader = effect.makeShaderWithChildren(flatUniforms(lookUniforms(id, size, size)), [
            child,
        ]);
        const surface = ck.MakeSurface(size, size);
        if (!surface) throw new Error("surface");
        const paint = new ck.Paint();
        paint.setShader(shader);
        surface.getCanvas().drawPaint(paint);
        const out = surface.getCanvas().readPixels(size / 2, size / 2, {
            ...info,
            width: 1,
            height: 1,
        });
        surface.delete();
        if (!out) throw new Error("read");
        return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
    }

    test("compiles as a Skia runtime effect with an image child", () => {
        const effect = ck.RuntimeEffect.Make(FILM_SHADER);
        expect(effect).not.toBeNull();
        expect(effect?.getUniformFloatCount()).toBe(27);
    });

    test("natural leaves the photo as shot", () => {
        const [r, g, b] = develop("natural@1", [180, 120, 60]);
        expect(Math.abs(r - 180)).toBeLessThanOrEqual(1);
        expect(Math.abs(g - 120)).toBeLessThanOrEqual(1);
        expect(Math.abs(b - 60)).toBeLessThanOrEqual(1);
    });

    test("mono turns colour to grey", () => {
        const [r, g, b] = develop("mono@1", [200, 60, 60]);
        expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
        expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
    });

    test("warm '98 pushes red up and blue down", () => {
        const [r, , b] = develop("warm-98@1", [128, 128, 128]);
        expect(r).toBeGreaterThan(b + 10);
    });

    /** A gradient with a bright square, so halation and the vignette both have work to do. */
    function testImage(width: number, height: number): Uint8Array {
        const rgb = new Uint8Array(width * height * 3);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const j = (y * width + x) * 3;
                const bright = x > 20 && x < 36 && y > 18 && y < 30;
                rgb[j] = bright ? 250 : Math.round((x / width) * 220);
                rgb[j + 1] = bright ? 245 : Math.round((y / height) * 200);
                rgb[j + 2] = bright ? 240 : 90;
            }
        }
        return rgb;
    }

    function shade(id: LookId, rgb: Uint8Array, width: number, height: number): Uint8Array {
        const effect = ck.RuntimeEffect.Make(FILM_SHADER);
        if (!effect) throw new Error("effect");
        const rgba = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            rgba.set([rgb[i * 3] ?? 0, rgb[i * 3 + 1] ?? 0, rgb[i * 3 + 2] ?? 0, 255], i * 4);
        }
        const info = {
            width,
            height,
            colorType: ck.ColorType.RGBA_8888,
            alphaType: ck.AlphaType.Unpremul,
            colorSpace: ck.ColorSpace.SRGB,
        };
        const image = ck.MakeImage(info, rgba, width * 4);
        if (!image) throw new Error("image");
        const child = image.makeShaderOptions(
            ck.TileMode.Clamp,
            ck.TileMode.Clamp,
            ck.FilterMode.Nearest,
            ck.MipmapMode.None,
        );
        const uniforms = { ...lookUniforms(id, width, height), grain: 0 };
        const shader = effect.makeShaderWithChildren(flatUniforms(uniforms), [child]);
        const surface = ck.MakeSurface(width, height);
        if (!surface) throw new Error("surface");
        const paint = new ck.Paint();
        paint.setShader(shader);
        surface.getCanvas().drawPaint(paint);
        const out = surface.getCanvas().readPixels(0, 0, info);
        surface.delete();
        if (!out) throw new Error("read");
        return new Uint8Array(out);
    }

    test.each(LOOK_IDS)("applyLook matches the shader for %s", (id) => {
        const width = 64;
        const height = 48;
        const rgb = testImage(width, height);
        const expected = shade(id, rgb, width, height);
        const actual = applyLook(rgb, width, height, { ...LOOKS[id], grain: 0 }, 1);
        let worst = 0;
        for (let i = 0; i < width * height; i++) {
            for (let c = 0; c < 3; c++) {
                const diff = Math.abs((actual[i * 3 + c] ?? 0) - (expected[i * 4 + c] ?? 0));
                worst = Math.max(worst, diff);
            }
        }
        expect(worst).toBeLessThanOrEqual(3);
    });

    test("applyLook adds grain only when the look has it", () => {
        const rgb = new Uint8Array(16 * 16 * 3).fill(128);
        const natural = applyLook(rgb, 16, 16, LOOKS["natural@1"], 7);
        expect(natural.every((v) => v === 128)).toBe(true);
        const mono = applyLook(rgb, 16, 16, { ...LOOKS["mono@1"], vignette: 0 }, 7);
        expect(new Set(mono).size).toBeGreaterThan(1);
    });
});
