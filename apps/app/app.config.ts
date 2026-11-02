import type { ExpoConfig } from "expo/config";

const NIGHT = "#0D0D0D";
const CAMERA =
    "Linger uses the camera to take the photos you share with an event. Photos stay hidden until the reveal.";
const PHOTOS =
    "Linger opens your photo library so you can choose a cover photo, and saves an event's photos into an album named after it.";
const SAVE_PHOTOS = "Linger saves the photos you choose to your photo library.";
/** Guests' links and printed codes point here; the app opens them when it's installed. */
const JOIN_HOST = "join.lingercam.app";

const config: ExpoConfig = {
    name: "Linger",
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
        supportsTablet: false,
        config: { usesNonExemptEncryption: false },
        infoPlist: { NSCameraUsageDescription: CAMERA, NSSupportsLiveActivities: true },
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
        name: "Linger",
        shortName: "Linger",
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
            { photosPermission: PHOTOS, cameraPermission: CAMERA, microphonePermission: false },
        ],
        ["expo-media-library", { photosPermission: PHOTOS, savePhotosPermission: SAVE_PHOTOS }],
        "@bacons/apple-targets",
    ],
    extra: { eas: { projectId: "e22ab7d1-7ced-4349-b6be-3908cd3c8986" } },
    experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
