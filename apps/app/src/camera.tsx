import type { LookId } from "@linger/core/film";
import { Asset } from "expo-asset";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet } from "react-native";
import {
    Camera,
    CommonResolutions,
    VisionCamera,
    useCameraDevice,
    useCameraPermission,
    usePhotoOutput,
} from "react-native-vision-camera";

import { t } from "@/copy";
import { DEMO_PHOTOS } from "@/demo";
import { LookImage } from "@/look";
import { CameraFrame, useCameraEvent, type Lens } from "@/shutter";

// VisionCamera 5 draws its preview natively. Applying the film look to the live preview needs its
// separate Skia frame processor package, so the preview stays plain and the look shows on the
// last-shot thumbnail (drawn through core's FILM_SHADER) and on every developed photo.

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

function uploadsDirectory(): Directory {
    const dir = new Directory(Paths.document, "uploads");
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    return dir;
}

/** Moves a photo out of temporary storage so it survives until it has uploaded. */
async function keep(source: File, move: boolean): Promise<string> {
    const target = new File(uploadsDirectory(), `${randomUUID()}.jpg`);
    if (move) await source.move(target);
    else await source.copy(target);
    return target.uri;
}

function useNativeLens(look: LookId, active: boolean): Lens {
    const access = useCameraAccess();
    const hasCamera = useHasCamera();
    const [position, setPosition] = useState<"back" | "front">("back");
    const device = useCameraDevice(
        position,
        position === "back" ? { physicalDevices: ["ultra-wide-angle", "wide-angle"] } : undefined,
    );
    const photos = usePhotoOutput({
        targetResolution: CommonResolutions.QHD_4_3,
        containerFormat: "jpeg",
        quality: 0.85,
    });
    const [flash, setFlash] = useState(false);
    const [wide, setWide] = useState(false);
    const [sample, setSample] = useState(0);

    // Sample photos only stand in during development, so they never reach a real event.
    const demo = hasCamera === false && __DEV__;
    const normalZoom = device?.zoomLensSwitchFactors[0] ?? 1;
    const hasWide = device !== undefined && device.minZoom < normalZoom;
    const zoom = hasWide && wide ? device.minZoom : normalZoom;

    if (demo) {
        const source = DEMO_PHOTOS[sample % DEMO_PHOTOS.length] ?? DEMO_PHOTOS[0] ?? 0;
        return {
            view: <LookImage source={source} look={look} style={StyleSheet.absoluteFill} />,
            async capture() {
                const [asset] = await Asset.loadAsync(source);
                if (!asset?.localUri) throw new Error("The sample photo isn't available.");
                setSample((n) => n + 1);
                return keep(new File(asset.localUri), false);
            },
            flash: { on: flash, available: true, toggle: () => setFlash((f) => !f) },
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
                        message: t("camera.denied"),
                        action: { label: t("join.openSettings"), run: access.openSettings },
                    }
              : null;

    return {
        view:
            device && access.granted ? (
                <Camera
                    style={StyleSheet.absoluteFill}
                    device={device}
                    isActive={active}
                    outputs={[photos]}
                    zoom={zoom}
                    resizeMode="cover"
                />
            ) : null,
        async capture() {
            const shot = await photos.capturePhotoToFile(
                { flashMode: flash && device?.hasFlash ? "on" : "off" },
                {},
            );
            const path = shot.filePath.startsWith("file:")
                ? shot.filePath
                : `file://${shot.filePath}`;
            return keep(new File(path), true);
        },
        flash: {
            on: flash,
            available: device?.hasFlash ?? false,
            toggle: () => setFlash((f) => !f),
        },
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
