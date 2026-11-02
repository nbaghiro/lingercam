import type { ExpoConfig } from "expo/config";

const NIGHT = "#0D0D0D";
const CAMERA =
    "Linger uses the camera to take the photos you share with an event. Photos stay hidden until the reveal.";
const PHOTOS = "Linger opens your photo library so you can choose a cover photo for an event.";
const SAVE_PHOTOS = "Linger saves the photos you choose to your photo library.";

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
    },
    android: {
        package: "app.galleo.linger",
        adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            monochromeImage: "./assets/adaptive-monochrome.png",
            backgroundColor: NIGHT,
        },
        permissions: ["android.permission.CAMERA"],
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
        ["expo-notifications", { color: "#E9C99A" }],
        "expo-secure-store",
        [
            "expo-image-picker",
            { photosPermission: PHOTOS, cameraPermission: CAMERA, microphonePermission: false },
        ],
        ["expo-media-library", { photosPermission: PHOTOS, savePhotosPermission: SAVE_PHOTOS }],
        "@bacons/apple-targets",
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
