import type { LookId } from "@linger/core/film";
import { Asset } from "expo-asset";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { t } from "@/copy";
import { DEMO_PHOTOS } from "@/demo";
import { LOOK_FILTERS, LookImage } from "@/look.web";
import { CameraFrame, useCameraEvent, type Lens } from "@/shutter";

// The browser camera: getUserMedia into a <video>, captured through a canvas. The look shows live
// as a CSS filter; the photo itself is sent as shot and developed with the real film on the server.

/** Longest edge of a photo taken in the browser. Small enough to wait in browser storage. */
const MAX_EDGE = 1600;

export function CameraScreen() {
    const event = useCameraEvent();
    const lens = useWebLens(event.look);
    return <CameraFrame event={event} lens={lens} />;
}

export interface CameraAccess {
    granted: boolean | undefined;
    canAsk: boolean;
    request: () => Promise<boolean>;
    openSettings: () => void;
}

type PermissionValue = "granted" | "denied" | "prompt" | "unknown";

/** The browser's camera permission, where the browser reports it. */
export function useCameraAccess(): CameraAccess {
    const [state, setState] = useState<PermissionValue>("unknown");

    useEffect(() => {
        let live = true;
        navigator.permissions
            ?.query({ name: "camera" as PermissionName })
            .then((status) => {
                if (live) setState(status.state);
                status.onchange = () => {
                    if (live) setState(status.state);
                };
            })
            .catch(() => null);
        return () => {
            live = false;
        };
    }, []);

    return {
        granted: state === "granted",
        canAsk: state !== "denied",
        async request() {
            if (!navigator.mediaDevices?.getUserMedia) return true;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                for (const track of stream.getTracks()) track.stop();
                setState("granted");
                return true;
            } catch (error) {
                // No camera at all is handled by the camera screen, so the guest can go on.
                if (error instanceof DOMException && error.name === "NotFoundError") return true;
                setState("denied");
                return false;
            }
        },
        openSettings: () => undefined,
    };
}

function draw(source: CanvasImageSource, width: number, height: number): string {
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available.");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
}

async function drawSample(source: number): Promise<string> {
    const image = new Image();
    image.src = Asset.fromModule(source).uri;
    await image.decode();
    return draw(image, image.naturalWidth, image.naturalHeight);
}

type Status = "starting" | "live" | "denied" | "none";

interface TorchTrack {
    applyConstraints(constraints: { advanced: { torch: boolean }[] }): Promise<void>;
}

function useWebLens(look: LookId): Lens {
    const video = useRef<HTMLVideoElement | null>(null);
    const [facing, setFacing] = useState<"environment" | "user">("environment");
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [status, setStatus] = useState<Status>(() =>
        typeof navigator !== "undefined" && "mediaDevices" in navigator ? "starting" : "none",
    );
    const [attempt, setAttempt] = useState(0);
    const [torch, setTorch] = useState(false);
    const [sample, setSample] = useState(0);

    useEffect(() => {
        let live = true;
        let opened: MediaStream | null = null;
        if (!("mediaDevices" in navigator)) return;
        navigator.mediaDevices
            .getUserMedia({
                audio: false,
                video: {
                    facingMode: { ideal: facing },
                    width: { ideal: 2048 },
                    height: { ideal: 2048 },
                },
            })
            .then((s) => {
                opened = s;
                if (!live) {
                    for (const track of s.getTracks()) track.stop();
                    return;
                }
                setStream(s);
                setStatus("live");
            })
            .catch((error: unknown) => {
                if (!live) return;
                const name = error instanceof DOMException ? error.name : "";
                setStatus(
                    name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none",
                );
            });
        return () => {
            live = false;
            if (opened) for (const track of opened.getTracks()) track.stop();
            setStream(null);
        };
    }, [facing, attempt]);

    useEffect(() => {
        const element = video.current;
        if (element && stream) {
            element.srcObject = stream;
            element.play().catch(() => null);
        }
    }, [stream]);

    const track = stream?.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
    const torchAvailable = capabilities?.torch === true;

    // Sample photos stand in during development where there is no camera, as in a headless browser.
    const demo = status === "none" && __DEV__;

    if (demo) {
        const source = DEMO_PHOTOS[sample % DEMO_PHOTOS.length] ?? DEMO_PHOTOS[0] ?? 0;
        return {
            view: <LookImage source={source} look={look} style={StyleSheet.absoluteFill} />,
            async capture() {
                const uri = await drawSample(source);
                setSample((n) => n + 1);
                return uri;
            },
            flash: { on: false, available: false, toggle: () => undefined },
            zoom: { wide: false, available: false, set: () => undefined },
            flip: { available: true, run: () => setSample((n) => n + 1) },
            demo: true,
            blocked: null,
        };
    }

    return {
        view: (
            <View style={StyleSheet.absoluteFill}>
                <video
                    ref={video}
                    autoPlay
                    playsInline
                    muted
                    style={{
                        position: "absolute",
                        inset: 0,
                        display: "block",
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: LOOK_FILTERS[look],
                        transform: facing === "user" ? "scaleX(-1)" : undefined,
                    }}
                />
            </View>
        ),
        async capture() {
            const element = video.current;
            if (!element || element.videoWidth === 0) throw new Error("The camera isn't ready.");
            return draw(element, element.videoWidth, element.videoHeight);
        },
        flash: {
            on: torch,
            available: torchAvailable,
            toggle: () => {
                const next = !torch;
                (track as unknown as TorchTrack | undefined)
                    ?.applyConstraints({ advanced: [{ torch: next }] })
                    .then(() => setTorch(next))
                    .catch(() => null);
            },
        },
        zoom: { wide: false, available: false, set: () => undefined },
        flip: {
            available: status === "live",
            run: () => {
                setTorch(false);
                setFacing((f) => (f === "environment" ? "user" : "environment"));
            },
        },
        demo: false,
        blocked:
            status === "denied"
                ? {
                      message: t("camera.webDenied"),
                      action: { label: t("common.retry"), run: () => setAttempt((n) => n + 1) },
                  }
                : status === "none"
                  ? { message: t("camera.none") }
                  : null,
    };
}
