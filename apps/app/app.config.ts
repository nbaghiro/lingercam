import type { ExpoConfig } from "expo/config";

const NIGHT = "#0D0D0D";
const CAMERA =
    "LingerCam uses the camera to take the photos you share with an event. Photos stay hidden until the reveal.";
const PHOTOS =
    "LingerCam opens your photo library so you can choose a cover photo, and saves an event's photos into an album named after it.";
const SAVE_PHOTOS = "LingerCam saves the photos you choose to your photo library.";
// The camera library links the microphone API, so App Store Connect needs a purpose string even
// though LingerCam never asks for the microphone.
const MICROPHONE = "LingerCam only takes photos and never records sound.";
/** Guests' links and printed codes point here; the app opens them when it's installed. */
const JOIN_HOST = "join.lingercam.app";

const config: ExpoConfig = {
    name: "LingerCam",
    slug: "linger",
    scheme: "linger",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    backgroundColor: NIGHT,
    runtimeVersion: { policy: "fingerprint" },
    ios: {
        bundleIdentifier: "app.galleo.linger",
        // GalleoApp, Inc.'s team, for signing builds for a phone. Set APPLE_TEAM_ID in the shell
        // or in apps/app/.env.local; simulator builds don't need it.
        ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
        supportsTablet: false,
        config: { usesNonExemptEncryption: false },
        infoPlist: {
            NSCameraUsageDescription: CAMERA,
            NSMicrophoneUsageDescription: MICROPHONE,
            NSSupportsLiveActivities: true,
        },
        associatedDomains: [`applinks:${JOIN_HOST}`],
    },
    android: {
        package: "app.galleo.linger",
        adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            monochromeImage: "./assets/adaptive-monochrome.png",
            backgroundColor: NIGHT,
        },
        permissions: ["android.permission.CAMERA"],
        intentFilters: [
            {
                action: "VIEW",
                autoVerify: true,
                data: [{ scheme: "https", host: JOIN_HOST }],
                category: ["BROWSABLE", "DEFAULT"],
            },
        ],
    },
    web: {
        output: "single",
        favicon: "./assets/favicon.png",
        backgroundColor: NIGHT,
        themeColor: NIGHT,
        name: "LingerCam",
        shortName: "LingerCam",
    },
    plugins: [
        "expo-router",
        "expo-font",
        [
            "expo-splash-screen",
            { image: "./assets/splash-icon.png", imageWidth: 120, backgroundColor: NIGHT },
        ],
        // Background remote notifications let a silent push reschedule a reveal reminder.
        ["expo-notifications", { color: "#E9C99A", enableBackgroundRemoteNotifications: true }],
        "expo-secure-store",
        [
            "expo-image-picker",
            {
                photosPermission: PHOTOS,
                cameraPermission: CAMERA,
                microphonePermission: MICROPHONE,
            },
        ],
        ["expo-media-library", { photosPermission: PHOTOS, savePhotosPermission: SAVE_PHOTOS }],
        "@bacons/apple-targets",
    ],
    extra: { eas: { projectId: "e22ab7d1-7ced-4349-b6be-3908cd3c8986" } },
    experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
