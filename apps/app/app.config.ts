import type { ExpoConfig } from "expo/config";
import { withEntitlementsPlist, type ConfigPlugin } from "expo/config-plugins";

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
/**
 * A build signed by a free Personal Team, for a phone before GalleoApp, Inc.'s team exists. Free
 * teams can't sign push or associated domains, and the real bundle id stays free for the company.
 */
const PERSONAL_TEAM = process.env.PERSONAL_TEAM === "1";
const BUNDLE_ID = PERSONAL_TEAM ? "app.lingercam.dev" : "app.lingercam";

// A store build without RevenueCat's keys can't sell plans, so App Review would hit a paid start
// that doesn't work. The keys come from EAS environment variables.
if (process.env.EAS_BUILD_PROFILE === "production") {
    const key =
        process.env.EAS_BUILD_PLATFORM === "android"
            ? "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY"
            : "EXPO_PUBLIC_REVENUECAT_IOS_KEY";
    if (!process.env[key]) throw new Error(`A production build needs ${key}.`);
}

/** Drops the push and associated-domains entitlements, which a free team can't sign. */
const forPersonalTeam: ConfigPlugin = (config) =>
    withEntitlementsPlist(config, (mod) => {
        delete mod.modResults["aps-environment"];
        delete mod.modResults["com.apple.developer.associated-domains"];
        return mod;
    });

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
        bundleIdentifier: BUNDLE_ID,
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
        associatedDomains: PERSONAL_TEAM ? [] : [`applinks:${JOIN_HOST}`],
    },
    android: {
        package: "app.lingercam",
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

export default PERSONAL_TEAM ? forPersonalTeam(config) : config;
