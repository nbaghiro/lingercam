import type { LookId } from "@linger/core/film";
import { Asset } from "expo-asset";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { t } from "@/copy";
import { DEMO_PHOTOS } from "@/demo";
import { LookImage, LookVignette, lookFilter } from "@/look.web";
import { CameraFrame, useCameraEvent, type Capture, type FlashMode, type Lens } from "@/shutter";

// The browser camera: getUserMedia into a <video>, captured through a canvas or, where the
// browser has it, ImageCapture for a real still. The look shows live as an SVG filter; the photo
// itself is sent as shot and developed with the real film on the server.

/** Longest edge of a photo taken in the browser. Small enough to wait in browser storage. */
const MAX_EDGE = 1600;
/** Longest edge of the last-shot thumbnail. */
const THUMB_EDGE = 192;

const VIDEO: MediaTrackConstraints = {
    width: { ideal: 2048 },
    height: { ideal: 2048 },
};

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

// The stream opened to ask for the camera is handed to the camera screen, so Safari asks once.
let handed: MediaStream | null = null;
let handedTimer: ReturnType<typeof setTimeout> | undefined;

function stopStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) track.stop();
}

function handOver(stream: MediaStream): void {
    if (handed) stopStream(handed);
    handed = stream;
    if (handedTimer) clearTimeout(handedTimer);
    // Nobody picked it up, so the camera light shouldn't stay on.
    handedTimer = setTimeout(() => {
        if (handed) stopStream(handed);
        handed = null;
    }, 30_000);
}

function takeHanded(): MediaStream | null {
    const stream = handed;
    handed = null;
    if (handedTimer) clearTimeout(handedTimer);
    return stream?.getVideoTracks().some((track) => track.readyState === "live") ? stream : null;
}

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
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: { ...VIDEO, facingMode: { ideal: "environment" } },
                });
                handOver(stream);
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

function toCanvas(
    source: CanvasImageSource,
    width: number,
    height: number,
    edge: number,
    mirror: boolean,
): HTMLCanvasElement {
    const scale = Math.min(1, edge / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available.");
    if (mirror) {
        // The front preview is mirrored, so the photo matches what the guest saw.
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function draw(source: CanvasImageSource, width: number, height: number, mirror = false): Capture {
    return {
        uri: toCanvas(source, width, height, MAX_EDGE, mirror).toDataURL("image/jpeg", 0.85),
        thumb: toCanvas(source, width, height, THUMB_EDGE, mirror).toDataURL("image/jpeg", 0.8),
    };
}

async function drawSample(source: number): Promise<Capture> {
    const image = new Image();
    image.src = Asset.fromModule(source).uri;
    await image.decode();
    return draw(image, image.naturalWidth, image.naturalHeight);
}

// ImageCapture (Chrome on Android and desktop) takes a real still, with the flash where there is
// one. TypeScript's DOM types don't include it yet.
interface StillCapture {
    takePhoto(settings?: { fillLightMode?: "auto" | "flash" | "off" }): Promise<Blob>;
    getPhotoCapabilities(): Promise<{ fillLightMode?: string[] }>;
}
type StillCaptureClass = new (track: MediaStreamTrack) => StillCapture;

function stillCapture(): StillCaptureClass | undefined {
    return (globalThis as { ImageCapture?: StillCaptureClass }).ImageCapture;
}

async function takeStill(
    track: MediaStreamTrack,
    flash: FlashMode,
    mirror: boolean,
): Promise<Capture | null> {
    const Still = stillCapture();
    if (!Still) return null;
    try {
        const still = new Still(track);
        const modes = (await still.getPhotoCapabilities()).fillLightMode ?? [];
        const wanted = flash === "on" ? "flash" : flash;
        const blob = await still.takePhoto(
            modes.includes(wanted) ? { fillLightMode: wanted } : undefined,
        );
        const bitmap = await createImageBitmap(blob);
        try {
            return draw(bitmap, bitmap.width, bitmap.height, mirror);
        } finally {
            bitmap.close();
        }
    } catch {
        return null;
    }
}

type Status = "starting" | "live" | "denied" | "none";

interface TorchTrack {
    applyConstraints(constraints: { advanced: { torch: boolean }[] }): Promise<void>;
}

function setTorch(track: MediaStreamTrack, on: boolean): Promise<void> {
    return (track as unknown as TorchTrack).applyConstraints({ advanced: [{ torch: on }] });
}

/** False while the tab is hidden, so the camera isn't left running behind another tab. */
function usePageVisible(): boolean {
    const [visible, setVisible] = useState(
        () => typeof document === "undefined" || document.visibilityState !== "hidden",
    );
    useEffect(() => {
        const update = () => setVisible(document.visibilityState !== "hidden");
        document.addEventListener("visibilitychange", update);
        return () => document.removeEventListener("visibilitychange", update);
    }, []);
    return visible;
}

function useWebLens(look: LookId): Lens {
    const video = useRef<HTMLVideoElement | null>(null);
    const visible = usePageVisible();
    const [facing, setFacing] = useState<"environment" | "user">("environment");
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [status, setStatus] = useState<Status>(() =>
        typeof navigator !== "undefined" && "mediaDevices" in navigator ? "starting" : "none",
    );
    const [attempt, setAttempt] = useState(0);
    const [sample, setSample] = useState(0);

    useEffect(() => {
        let live = true;
        let opened: MediaStream | null = null;
        if (!visible || !("mediaDevices" in navigator)) return;
        const use = (s: MediaStream) => {
            opened = s;
            if (!live) {
                stopStream(s);
                return;
            }
            setStream(s);
            setStatus("live");
        };
        const ready = facing === "environment" ? takeHanded() : null;
        if (ready) use(ready);
        else {
            navigator.mediaDevices
                .getUserMedia({ audio: false, video: { ...VIDEO, facingMode: { ideal: facing } } })
                .then(use)
                .catch((error: unknown) => {
                    if (!live) return;
                    const name = error instanceof DOMException ? error.name : "";
                    setStatus(
                        name === "NotAllowedError" || name === "SecurityError" ? "denied" : "none",
                    );
                });
        }
        return () => {
            live = false;
            if (opened) stopStream(opened);
            setStream(null);
        };
    }, [facing, attempt, visible]);

    useEffect(() => {
        const element = video.current;
        if (element && stream) {
            element.srcObject = stream;
            element.play().catch(() => null);
        }
    }, [stream]);

    const track = stream?.getVideoTracks()[0];
    const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
    const torch = capabilities?.torch === true;
    const front = facing === "user";

    // Sample photos stand in during development where there is no camera, as in a headless browser.
    const demo = status === "none" && __DEV__;

    if (demo) {
        const source = DEMO_PHOTOS[sample % DEMO_PHOTOS.length] ?? DEMO_PHOTOS[0] ?? 0;
        return {
            view: <LookImage source={source} look={look} style={StyleSheet.absoluteFill} />,
            async capture() {
                const shot = await drawSample(source);
                setSample((n) => n + 1);
                return shot;
            },
            flash: "none",
            zoom: { wide: false, available: false, set: () => undefined },
            flip: { available: true, run: () => setSample((n) => n + 1) },
            demo: true,
            blocked: null,
        };
    }

    return {
        view: (
            <View style={StyleSheet.absoluteFill}>
                <div style={CLIP}>
                    <video
                        ref={video}
                        autoPlay
                        playsInline
                        muted
                        style={{
                            position: "absolute",
                            inset: -1,
                            display: "block",
                            width: "calc(100% + 2px)",
                            height: "calc(100% + 2px)",
                            objectFit: "cover",
                            filter: lookFilter(look),
                            transform: front ? "scaleX(-1)" : undefined,
                        }}
                    />
                    <LookVignette look={look} />
                </div>
            </View>
        ),
        async capture(flash) {
            const element = video.current;
            if (!element || !track || element.videoWidth === 0) {
                throw new Error("The camera isn't ready.");
            }
            const still = await takeStill(track, front ? "off" : flash, front);
            if (still) return still;
            const lit = torch && flash === "on";
            if (lit) {
                await setTorch(track, true).catch(() => null);
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
            try {
                return draw(element, element.videoWidth, element.videoHeight, front);
            } finally {
                if (lit) await setTorch(track, false).catch(() => null);
            }
        },
        flash: front ? "screen" : torch ? "flash" : "none",
        zoom: { wide: false, available: false, set: () => undefined },
        flip: {
            available: status === "live",
            run: () => setFacing((f) => (f === "environment" ? "user" : "environment")),
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

// Rounded clipping that holds in Safari and Chromium, where a playing <video> otherwise shows
// light slivers past the corners.
const CLIP = {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    borderRadius: 28,
    clipPath: "inset(0 round 28px)",
    WebkitMaskImage: "-webkit-radial-gradient(white, black)",
    transform: "translateZ(0)",
} as const;
