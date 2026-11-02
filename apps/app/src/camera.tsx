import { FILM_SHADER, flatUniforms, lookUniforms, type LookId } from "@linger/core/film";
import { FilterMode, MipmapMode, Skia, TileMode } from "@shopify/react-native-skia";
import { Asset } from "expo-asset";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import {
    CommonResolutions,
    VisionCamera,
    useCameraDevice,
    useCameraPermission,
    usePhotoOutput,
    type Frame,
} from "react-native-vision-camera";
import {
    SkiaCamera,
    type SkiaCameraRef,
    type SkiaOnFrameState,
} from "react-native-vision-camera-skia";

import { t } from "@/copy";
import { DEMO_PHOTOS } from "@/demo";
import { LookImage } from "@/look";
import { CameraFrame, useCameraEvent, type Capture, type FlashMode, type Lens } from "@/shutter";

// The native camera: VisionCamera frames drawn through core's FILM_SHADER with Skia, so the
// viewfinder shows the event's look live. Photos are captured in full, scaled to 2048 px for the
// upload queue, with a small copy for the last-shot thumbnail.

/** Longest edge of a photo sent from the app; the server develops at the same size. */
const MAX_EDGE = 2048;
const THUMB_EDGE = 192;
/** Pinch zoom stops here, past which a phone camera only enlarges noise. */
const MAX_PINCH_ZOOM = 8;

const effect = Skia.RuntimeEffect.Make(FILM_SHADER);
const paint = Skia.Paint();

export function CameraScreen() {
    const event = useCameraEvent();
    const [focused, setFocused] = useState(true);
    useFocusEffect(
        useCallback(() => {
            setFocused(true);
            return () => setFocused(false);
        }, []),
    );
    const lens = useNativeLens(event.look, focused);
    return <CameraFrame event={event} lens={lens} />;
}

/** `undefined` while the cameras are listed, then whether this device has any. */
function useHasCamera(): boolean | undefined {
    const [has, setHas] = useState<boolean>();
    useEffect(() => {
        let live = true;
        VisionCamera.createDeviceFactory()
            .then((factory) => {
                if (live) setHas(factory.cameraDevices.length > 0);
            })
            .catch(() => {
                if (live) setHas(false);
            });
        return () => {
            live = false;
        };
    }, []);
    return has;
}

export interface CameraAccess {
    /** `undefined` while it's being checked. */
    granted: boolean | undefined;
    /** The system prompt can still be shown. Otherwise only Settings can change it. */
    canAsk: boolean;
    request: () => Promise<boolean>;
    openSettings: () => void;
}

/** The camera permission. Without a camera (the simulator) there is nothing to allow. */
export function useCameraAccess(): CameraAccess {
    const permission = useCameraPermission();
    const hasCamera = useHasCamera();
    return {
        granted: hasCamera === undefined ? undefined : !hasCamera || permission.hasPermission,
        canAsk: permission.canRequestPermission,
        request: permission.requestPermission,
        openSettings: () => {
            Linking.openSettings().catch(() => null);
        },
    };
}

function directory(name: string): Directory {
    const dir = new Directory(Paths.document, name);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
}

const asUri = (path: string) => (path.startsWith("file:") ? path : `file://${path}`);

/** Moves a photo out of temporary storage so it survives until it has uploaded. */
async function keep(source: File, folder: string, move: boolean): Promise<string> {
    const target = new File(directory(folder), `${randomUUID()}.jpg`);
    if (move) await source.move(target);
    else await source.copy(target);
    return target.uri;
}

function fit(width: number, height: number, edge: number): { width: number; height: number } {
    const scale = Math.min(1, edge / Math.max(width, height));
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function useNativeLens(look: LookId, active: boolean): Lens {
    const access = useCameraAccess();
    const hasCamera = useHasCamera();
    const [camera, setCamera] = useState<SkiaCameraRef | null>(null);
    const [position, setPosition] = useState<"back" | "front">("back");
    const device = useCameraDevice(
        position,
        position === "back" ? { physicalDevices: ["ultra-wide-angle", "wide-angle"] } : undefined,
    );
    const photos = usePhotoOutput({
        targetResolution: CommonResolutions.QHD_4_3,
        containerFormat: "jpeg",
        quality: 0.9,
    });
    const [wide, setWide] = useState(false);
    const [sample, setSample] = useState(0);

    // Sample photos only stand in during development, so they never reach a real event.
    const demo = hasCamera === false && __DEV__;
    const normalZoom = device?.zoomLensSwitchFactors[0] ?? 1;
    const minZoom = device?.minZoom ?? 1;
    const maxZoom = Math.min(device?.maxZoom ?? 1, normalZoom * MAX_PINCH_ZOOM);
    const hasWide = device !== undefined && minZoom < normalZoom;
    const zoom = useSharedValue(normalZoom);
    const pinchStart = useSharedValue(normalZoom);

    useEffect(() => {
        zoom.set(hasWide && wide ? minZoom : normalZoom);
    }, [hasWide, wide, minZoom, normalZoom, zoom]);

    // The film look's uniforms, less the resolution, which each frame supplies.
    const uniforms = useMemo(() => flatUniforms(lookUniforms(look, 1, 1)).slice(2), [look]);

    const onFrame = useCallback(
        (frame: Frame, render: (draw: (state: SkiaOnFrameState) => void) => void) => {
            "worklet";
            render(({ canvas, frameTexture }) => {
                if (!effect) {
                    canvas.drawImage(frameTexture, 0, 0);
                    return;
                }
                const image = frameTexture.makeShaderOptions(
                    TileMode.Clamp,
                    TileMode.Clamp,
                    FilterMode.Linear,
                    MipmapMode.None,
                );
                const shader = effect.makeShaderWithChildren(
                    [frameTexture.width(), frameTexture.height(), ...uniforms],
                    [image],
                );
                paint.setShader(shader);
                canvas.drawImage(frameTexture, 0, 0, paint);
            });
            frame.dispose();
        },
        [uniforms],
    );

    const focus = useCallback(
        (x: number, y: number) => {
            camera?.focusTo({ x, y }).catch(() => null);
        },
        [camera],
    );

    const gestures = useMemo(
        () =>
            Gesture.Simultaneous(
                Gesture.Pinch()
                    .onStart(() => {
                        pinchStart.set(zoom.get());
                    })
                    .onUpdate((e) => {
                        zoom.set(Math.min(maxZoom, Math.max(minZoom, pinchStart.get() * e.scale)));
                    }),
                Gesture.Tap()
                    .runOnJS(true)
                    .onEnd((e) => focus(e.x, e.y)),
            ),
        [focus, maxZoom, minZoom, pinchStart, zoom],
    );

    if (demo) {
        const source = DEMO_PHOTOS[sample % DEMO_PHOTOS.length] ?? DEMO_PHOTOS[0] ?? 0;
        return {
            view: <LookImage source={source} look={look} style={StyleSheet.absoluteFill} />,
            async capture(): Promise<Capture> {
                const [asset] = await Asset.loadAsync(source);
                if (!asset?.localUri) throw new Error("The sample photo isn't available.");
                setSample((n) => n + 1);
                const file = new File(asset.localUri);
                return {
                    uri: await keep(file, "uploads", false),
                    thumb: await keep(file, "thumbs", false),
                };
            },
            flash: "flash",
            zoom: { wide, available: true, set: setWide },
            flip: { available: true, run: () => setSample((n) => n + 1) },
            demo: true,
            blocked: null,
        };
    }

    const blocked: Lens["blocked"] =
        hasCamera === false
            ? { message: t("camera.none") }
            : access.granted === false
              ? access.canAsk
                  ? {
                        message: t("join.cameraBody"),
                        action: {
                            label: t("join.cameraAllow"),
                            run: () => {
                                access.request().catch(() => null);
                            },
                        },
                    }
                  : {
                        message: t("join.cameraDenied"),
                        action: { label: t("join.openSettings"), run: access.openSettings },
                    }
              : null;

    const front = position === "front";

    return {
        view:
            device && access.granted ? (
                <GestureDetector gesture={gestures}>
                    <View style={StyleSheet.absoluteFill} collapsable={false}>
                        <SkiaCamera
                            ref={setCamera}
                            style={StyleSheet.absoluteFill}
                            device={device}
                            isActive={active}
                            outputs={[photos]}
                            zoom={zoom}
                            onFrame={onFrame}
                            enablePreviewSizedOutputBuffers
                        />
                    </View>
                </GestureDetector>
            ) : null,
        async capture(flash: FlashMode): Promise<Capture> {
            const photo = await photos.capturePhoto(
                {
                    flashMode: device?.hasFlash && !front ? flash : "off",
                    // The system sound, which the silent switch mutes.
                    enableShutterSound: true,
                },
                {},
            );
            try {
                const image = await photo.toImageAsync();
                const full = fit(image.width, image.height, MAX_EDGE);
                const small = fit(image.width, image.height, THUMB_EDGE);
                const [resized, thumb] = await Promise.all([
                    image.resizeAsync(full.width, full.height),
                    image.resizeAsync(small.width, small.height),
                ]);
                const [fullPath, thumbPath] = await Promise.all([
                    resized.saveToTemporaryFileAsync("jpg", 85),
                    thumb.saveToTemporaryFileAsync("jpg", 80),
                ]);
                return {
                    uri: await keep(new File(asUri(fullPath)), "uploads", true),
                    thumb: await keep(new File(asUri(thumbPath)), "thumbs", true),
                };
            } finally {
                photo.dispose();
            }
        },
        flash: front ? "screen" : device?.hasFlash ? "flash" : "none",
        zoom: { wide, available: hasWide, set: setWide },
        flip: {
            available: true,
            run: () => {
                setWide(false);
                setPosition((p) => (p === "back" ? "front" : "back"));
            },
        },
        demo: false,
        blocked,
    };
}
