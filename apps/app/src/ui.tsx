import { FontDisplay, type FontSource } from "expo-font";
import * as Haptics from "expo-haptics";
import { Image, type ImageSource } from "expo-image";
import { useFocusEffect } from "expo-router";
import type { Occasion } from "@linger/core/events";
import { AirplaneTiltIcon } from "phosphor-react-native/src/icons/AirplaneTilt";
import { ArrowLeftIcon } from "phosphor-react-native/src/icons/ArrowLeft";
import { CakeIcon } from "phosphor-react-native/src/icons/Cake";
import { CameraIcon } from "phosphor-react-native/src/icons/Camera";
import { CameraRotateIcon } from "phosphor-react-native/src/icons/CameraRotate";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { ChampagneIcon } from "phosphor-react-native/src/icons/Champagne";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { DotsThreeIcon } from "phosphor-react-native/src/icons/DotsThree";
import { DownloadSimpleIcon } from "phosphor-react-native/src/icons/DownloadSimple";
import { EnvelopeSimpleIcon } from "phosphor-react-native/src/icons/EnvelopeSimple";
import { ExportIcon } from "phosphor-react-native/src/icons/Export";
import { EyeIcon } from "phosphor-react-native/src/icons/Eye";
import { EyeSlashIcon } from "phosphor-react-native/src/icons/EyeSlash";
import { FlagIcon } from "phosphor-react-native/src/icons/Flag";
import { GearSixIcon } from "phosphor-react-native/src/icons/GearSix";
import { HeartIcon } from "phosphor-react-native/src/icons/Heart";
import { ImageIcon } from "phosphor-react-native/src/icons/Image";
import { LightningIcon } from "phosphor-react-native/src/icons/Lightning";
import { LightningSlashIcon } from "phosphor-react-native/src/icons/LightningSlash";
import { PlayIcon } from "phosphor-react-native/src/icons/Play";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { PrinterIcon } from "phosphor-react-native/src/icons/Printer";
import { QrCodeIcon } from "phosphor-react-native/src/icons/QrCode";
import { SignOutIcon } from "phosphor-react-native/src/icons/SignOut";
import { SunHorizonIcon } from "phosphor-react-native/src/icons/SunHorizon";
import { TrashIcon } from "phosphor-react-native/src/icons/Trash";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { Icon as PhosphorIcon, IconWeight } from "phosphor-react-native";
import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import {
    AccessibilityInfo,
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    Text as RNText,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
    useWindowDimensions,
    type StyleProp,
    type TextInputProps,
    type TextStyle,
    type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeIn,
    FadeOut,
    SlideInDown,
    SlideOutDown,
    useAnimatedStyle,
    withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { t } from "@/copy";

// Tokens. Sizes are iOS points, matching the approved design.

export const color = {
    night: "#0D0D0D",
    surface: "#1C1C19",
    raised: "#262622",
    paper: "#F3F1EC",
    ash: "#AAA79F",
    faint: "#6D6B65",
    candle: "#E9C99A",
    line: "rgba(255, 255, 255, 0.08)",
    /** Primary button fill and the invite card. */
    cream: "#F7F5F0",
    /** Text on cream and paper. */
    ink: "#121210",
    /** Text on candle. */
    candleInk: "#1A1610",
    /** The selected segment. */
    segment: "#34342F",
    /** A selected row. */
    selected: "#23231F",
    track: "#2C2C28",
    rule: "#3A3A35",
    /** Labels under stats and other soft text on photos. */
    soft: "#CFCBC3",
    sheet: "#161614",
    chip: "#1E1E1C",
    tile: "#222222",
    glass: "rgba(40, 40, 36, 0.7)",
    white: "#FFFFFF",
} as const;

/** Spacing, in points. Screens use these instead of literal paddings and margins. */
export const space = {
    xxs: 2,
    xs: 4,
    s: 8,
    m: 12,
    l: 16,
    xl: 22,
    xxl: 28,
    xxxl: 40,
} as const;

/** Corner radii, in points, from small tags to the sheet. */
export const radius = {
    tag: 7,
    s: 12,
    control: 15,
    tile: 16,
    row: 18,
    card: 22,
    invite: 32,
    sheet: 52,
    round: 999,
} as const;

/** The one divider between rows. */
export const divider = {
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    borderBottomColor: color.line,
} as const;

export const gutter = space.xl;

/** The gap between the two columns of tiles, and the grid's side margin. */
export const grid = { gap: 6, side: 12 } as const;

// Fonts. Newsreader comes in two cuts made from the variable font: Text (optical size 16) for
// names and serif text up to 23 pt, Display (36, italic 28) for titles and numbers above that.
// Both families are Latin subsets; the web loads woff2 and shows a system font until they arrive.

const display = FontDisplay.SWAP;

export const FONTS: Record<string, FontSource> = {
    "Newsreader-Text":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Newsreader-Text.woff2"), display }
            : require("../assets/fonts/Newsreader-Text.ttf"),
    "Newsreader-TextItalic":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Newsreader-TextItalic.woff2"), display }
            : require("../assets/fonts/Newsreader-TextItalic.ttf"),
    "Newsreader-Display":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Newsreader-Display.woff2"), display }
            : require("../assets/fonts/Newsreader-Display.ttf"),
    "Newsreader-DisplayItalic":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Newsreader-DisplayItalic.woff2"), display }
            : require("../assets/fonts/Newsreader-DisplayItalic.ttf"),
    "Pretendard-Regular":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Pretendard-Regular.woff2"), display }
            : require("../assets/fonts/Pretendard-Regular.otf"),
    "Pretendard-Medium":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Pretendard-Medium.woff2"), display }
            : require("../assets/fonts/Pretendard-Medium.otf"),
    "Pretendard-SemiBold":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Pretendard-SemiBold.woff2"), display }
            : require("../assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Bold":
        Platform.OS === "web"
            ? { uri: require("../assets/fonts/Pretendard-Bold.woff2"), display }
            : require("../assets/fonts/Pretendard-Bold.otf"),
};

/** On the web a family falls back to a system font while its file loads. */
function family(name: string, fallback: "serif" | "sans"): string {
    if (Platform.OS !== "web") return name;
    return fallback === "serif"
        ? `${name}, Georgia, serif`
        : `${name}, system-ui, -apple-system, sans-serif`;
}

const SERIF = {
    text: family("Newsreader-Text", "serif"),
    textItalic: family("Newsreader-TextItalic", "serif"),
    display: family("Newsreader-Display", "serif"),
    displayItalic: family("Newsreader-DisplayItalic", "serif"),
} as const;

const SANS = {
    regular: family("Pretendard-Regular", "sans"),
    medium: family("Pretendard-Medium", "sans"),
    semibold: family("Pretendard-SemiBold", "sans"),
    bold: family("Pretendard-Bold", "sans"),
} as const;

/** The Dynamic Type cap for labels inside fixed-size chrome: stats, tiles, camera controls. */
export const CHROME_SCALE = 1.3;

/** Serif text from this size up uses the Display cut. */
const DISPLAY_FROM = 24;

/** The serif family for a size: the Display cut for titles and numbers, Text below. */
export function serifFamily(fontSize: number, italic = false): string {
    if (fontSize >= DISPLAY_FROM) return italic ? SERIF.displayItalic : SERIF.display;
    return italic ? SERIF.textItalic : SERIF.text;
}

// Text

interface Variant {
    serif: boolean;
    italic?: boolean;
    fontSize: number;
    lineHeight: number;
    letterSpacing?: number;
    /** The largest Dynamic Type scale; titles stop growing so they still fit the screen. */
    maxScale?: number;
}

const VARIANTS = {
    /** Serif 42, screen titles like "What are we capturing?" */
    display: { serif: true, fontSize: 42, lineHeight: 44.5, letterSpacing: -0.84, maxScale: 1.2 },
    /** Serif 33, step and section titles. */
    title: { serif: true, fontSize: 33, lineHeight: 36.3, letterSpacing: -0.5, maxScale: 1.25 },
    /** Serif 38, the event name over its cover. */
    cover: { serif: true, fontSize: 38, lineHeight: 40, letterSpacing: -0.57, maxScale: 1.2 },
    /** Serif 30, the name on the invite card and sheet titles. */
    heading: { serif: true, fontSize: 30, lineHeight: 33, letterSpacing: -0.3, maxScale: 1.3 },
    /** Serif 21, card titles and the camera header. */
    name: { serif: true, fontSize: 21, lineHeight: 25, maxScale: 1.5 },
    /** Serif italic 27, numbers in the stat row. */
    number: { serif: true, italic: true, fontSize: 27, lineHeight: 30, maxScale: 1.3 },
    /** Sans 17, rows and controls. */
    body: { serif: false, fontSize: 17, lineHeight: 23, maxScale: 2 },
    /** Sans 15, supporting text. */
    small: { serif: false, fontSize: 15, lineHeight: 21.75, maxScale: 2 },
    /** Sans 13, captions and tick labels. */
    caption: { serif: false, fontSize: 13, lineHeight: 17, maxScale: 2 },
} as const satisfies Record<string, Variant>;

export type TextVariant = keyof typeof VARIANTS;
export type Tone = "paper" | "ash" | "faint" | "candle" | "ink" | "soft" | "white";

/** Faint on Night is about 3.6:1, so text smaller than this reads in Ash instead. */
const FAINT_FROM = 15;

/** Serif variants whose last two words are kept on one line. */
const TITLES: ReadonlySet<TextVariant> = new Set(["display", "title", "cover", "heading", "name"]);

/**
 * Joins the last two words with a no-break space, so a title never ends on one short word. iOS
 * does this itself with the push-out line break strategy.
 */
export function keepLastWordsTogether(text: string): string {
    const words = text.trim().split(" ");
    if (words.length < 3) return text;
    return `${words.slice(0, -1).join(" ")}\u00a0${words[words.length - 1] ?? ""}`;
}

export interface TextProps {
    children: ReactNode;
    variant?: TextVariant;
    tone?: Tone;
    /** Overrides the variant's role: serif for anything emotional, sans for controls. */
    serif?: boolean;
    italic?: boolean;
    weight?: keyof typeof SANS;
    align?: "left" | "center" | "right";
    numberOfLines?: number;
    style?: StyleProp<TextStyle>;
    accessibilityRole?: "header" | "text" | "link" | "alert";
    /** Overrides the variant's Dynamic Type cap, for labels inside fixed-size chrome. */
    maxScale?: number;
    /** Announces changes on the web; native screens announce through `useAnnounce`. */
    accessibilityLiveRegion?: "polite" | "assertive";
}

export function Text({
    children,
    variant = "body",
    tone = "paper",
    serif,
    italic,
    weight = "regular",
    align,
    numberOfLines,
    style,
    accessibilityRole,
    accessibilityLiveRegion,
    maxScale,
}: TextProps) {
    const v: Variant = VARIANTS[variant];
    const cap = maxScale ?? v.maxScale;
    const isSerif = serif ?? v.serif;
    const isItalic = italic ?? v.italic ?? false;
    const fontSize = StyleSheet.flatten(style)?.fontSize ?? v.fontSize;
    const fontFamily = isSerif ? serifFamily(fontSize, isItalic) : SANS[weight];
    const shown = tone === "faint" && fontSize < FAINT_FROM ? "ash" : tone;
    const title = isSerif && TITLES.has(variant);
    const content =
        title && Platform.OS !== "ios" && typeof children === "string"
            ? keepLastWordsTogether(children)
            : children;
    return (
        <RNText
            {...(numberOfLines !== undefined ? { numberOfLines } : {})}
            {...(accessibilityRole ? { accessibilityRole } : {})}
            {...(accessibilityLiveRegion ? { accessibilityLiveRegion } : {})}
            {...(cap ? { maxFontSizeMultiplier: cap } : {})}
            {...(title && Platform.OS === "ios"
                ? { lineBreakStrategyIOS: "push-out" as const }
                : {})}
            style={[
                {
                    fontFamily,
                    fontSize: v.fontSize,
                    lineHeight: v.lineHeight,
                    letterSpacing: v.letterSpacing ?? 0,
                    color: color[shown === "white" ? "white" : shown],
                },
                align ? { textAlign: align } : null,
                style,
            ]}
        >
            {content}
        </RNText>
    );
}

// Haptics and motion

export type HapticKind = "selection" | "light" | "medium" | "success" | "warning";

/** One haptic. Does nothing on the web. */
export function haptic(kind: HapticKind): void {
    if (Platform.OS === "web") return;
    const done = () => null;
    switch (kind) {
        case "selection":
            Haptics.selectionAsync().catch(done);
            return;
        case "light":
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(done);
            return;
        case "medium":
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(done);
            return;
        case "success":
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(done);
            return;
        case "warning":
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(done);
            return;
    }
}

let reduceMotion = false;
const motionListeners = new Set<() => void>();

AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => {
        reduceMotion = on;
        for (const listener of motionListeners) listener();
    })
    .catch(() => null);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
    reduceMotion = on;
    for (const listener of motionListeners) listener();
});

/** True when the person asked the system for less motion: cross-fades instead of slides. */
export function useReduceMotion(): boolean {
    return useSyncExternalStore(
        (listener) => {
            motionListeners.add(listener);
            return () => {
                motionListeners.delete(listener);
            };
        },
        () => reduceMotion,
        () => reduceMotion,
    );
}

/** Reads a line aloud with VoiceOver or TalkBack whenever it changes. The web uses live regions. */
export function useAnnounce(message: string | null | undefined): void {
    useEffect(() => {
        if (message && Platform.OS !== "web") AccessibilityInfo.announceForAccessibility(message);
    }, [message]);
}

// Icons. Regular for controls, duotone for occasions and features, fill for selected states.

export const icons = {
    camera: CameraIcon,
    qr: QrCodeIcon,
    download: DownloadSimpleIcon,
    back: ArrowLeftIcon,
    flashOff: LightningSlashIcon,
    flashOn: LightningIcon,
    flip: CameraRotateIcon,
    heart: HeartIcon,
    share: ExportIcon,
    check: CheckIcon,
    settings: GearSixIcon,
    plus: PlusIcon,
    close: XIcon,
    image: ImageIcon,
    print: PrinterIcon,
    email: EnvelopeSimpleIcon,
    signOut: SignOutIcon,
    trash: TrashIcon,
    chevron: CaretRightIcon,
    report: FlagIcon,
    hide: EyeSlashIcon,
    show: EyeIcon,
    play: PlayIcon,
    more: DotsThreeIcon,
    warning: WarningCircleIcon,
} as const;

export const occasionIcons: Record<Occasion, PhosphorIcon> = {
    wedding: HeartIcon,
    birthday: CakeIcon,
    trip: AirplaneTiltIcon,
    party: ChampagneIcon,
    everyday: SunHorizonIcon,
};

export interface IconProps {
    icon: PhosphorIcon;
    size?: number;
    color?: string;
    weight?: Extract<IconWeight, "regular" | "duotone" | "fill">;
}

export function Icon({ icon: Glyph, size = 21, color: tint = color.paper, weight }: IconProps) {
    const w = weight ?? "regular";
    return (
        <Glyph
            size={size}
            color={tint}
            weight={w}
            {...(w === "duotone" ? { duotoneColor: tint, duotoneOpacity: 0.3 } : {})}
        />
    );
}

// The mark: an outline circle and a solid circle overlapping it, a photo and its afterimage.

export function Mark({ size = 22, tint = color.paper }: { size?: number; tint?: string }) {
    return (
        <View aria-hidden style={{ width: size, height: size }}>
            <Svg width={size} height={size} viewBox="0 0 32 32">
                <Circle cx={12} cy={16} r={9} fill="none" stroke={tint} strokeWidth={2.2} />
                <Circle cx={20} cy={16} r={9} fill={tint} fillOpacity={0.9} />
            </Svg>
        </View>
    );
}

export function Wordmark({ size = 40 }: { size?: number }) {
    return (
        <View
            style={{ flexDirection: "row", alignItems: "center", gap: size * 0.24 }}
            accessible
            accessibilityRole="header"
            accessibilityLabel="Linger"
        >
            <Mark size={size * 0.9} />
            {/* A logo, drawn at its size whatever the text setting. */}
            <RNText
                allowFontScaling={false}
                style={{
                    fontFamily: serifFamily(size),
                    fontSize: size,
                    lineHeight: size * 1.1,
                    letterSpacing: -0.01 * size,
                    color: color.paper,
                }}
            >
                Linger
            </RNText>
        </View>
    );
}

// Buttons

export interface ButtonProps {
    label?: string;
    onPress?: () => void;
    variant?: "primary" | "dark" | "glass";
    icon?: PhosphorIcon;
    /** "fill" for a selected state, such as a liked photo. */
    iconWeight?: "regular" | "fill";
    /** 56 pt for screen actions, 48 pt for the row under an event cover. */
    size?: "regular" | "compact";
    loading?: boolean;
    disabled?: boolean;
    accessibilityLabel?: string;
    style?: StyleProp<ViewStyle>;
}

export function Button({
    label,
    onPress,
    variant = "primary",
    icon,
    iconWeight = "regular",
    size = "regular",
    loading = false,
    disabled = false,
    accessibilityLabel,
    style,
}: ButtonProps) {
    const primary = variant === "primary";
    // A disabled button is Raised with Faint text, so it can't be mistaken for a pressable one.
    const fg = disabled ? color.faint : primary ? color.ink : color.paper;
    const inactive = disabled || loading;
    return (
        <Pressable
            onPress={onPress}
            disabled={inactive}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel ?? label}
            accessibilityState={{ disabled: inactive, busy: loading }}
            style={({ pressed }) => [
                styles.button,
                size === "compact" ? styles.buttonCompact : null,
                {
                    backgroundColor: disabled
                        ? color.raised
                        : primary
                          ? color.cream
                          : variant === "glass"
                            ? color.glass
                            : color.raised,
                    opacity: pressed && !inactive ? 0.82 : 1,
                },
                style,
            ]}
        >
            {loading ? (
                <ActivityIndicator color={fg} />
            ) : (
                <>
                    {icon ? <Icon icon={icon} color={fg} weight={iconWeight} /> : null}
                    {label ? (
                        <Text weight="semibold" align="center" style={{ color: fg, flexShrink: 1 }}>
                            {label}
                        </Text>
                    ) : null}
                </>
            )}
        </Pressable>
    );
}

export interface IconButtonProps {
    icon: PhosphorIcon;
    onPress?: () => void;
    accessibilityLabel: string;
    variant?: "raised" | "glass";
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function IconButton({
    icon,
    onPress,
    accessibilityLabel,
    variant = "raised",
    disabled = false,
    style,
}: IconButtonProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            hitSlop={4}
            style={({ pressed }) => [
                styles.iconButton,
                {
                    backgroundColor: variant === "glass" ? color.glass : color.raised,
                    opacity: pressed && !disabled ? 0.75 : 1,
                },
                style,
            ]}
        >
            <Icon icon={icon} color={disabled ? color.faint : color.paper} />
        </Pressable>
    );
}

// Selection controls

export interface SegmentedProps<T extends string> {
    options: readonly { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    accessibilityLabel?: string;
}

export function Segmented<T extends string>({
    options,
    value,
    onChange,
    accessibilityLabel,
}: SegmentedProps<T>) {
    return (
        <View
            style={styles.segmented}
            accessibilityRole="radiogroup"
            {...(accessibilityLabel ? { accessibilityLabel } : {})}
        >
            {options.map((option) => {
                const on = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        onPress={() => {
                            if (option.value === value) return;
                            haptic("selection");
                            onChange(option.value);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        style={[styles.segment, on ? { backgroundColor: color.segment } : null]}
                    >
                        <Text
                            variant="small"
                            tone={on ? "paper" : "ash"}
                            weight={on ? "medium" : "regular"}
                            align="center"
                            numberOfLines={2}
                            maxScale={CHROME_SCALE}
                        >
                            {option.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

export interface OptionRowProps {
    icon: PhosphorIcon;
    label: string;
    selected: boolean;
    onPress: () => void;
}

/** A selectable row with a duotone icon, as on the occasion step. */
export function OptionRow({ icon, label, selected, onPress }: OptionRowProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[
                styles.row,
                selected
                    ? { borderColor: "rgba(255, 255, 255, 0.55)", backgroundColor: color.selected }
                    : null,
            ]}
        >
            <Icon
                icon={icon}
                size={24}
                weight="duotone"
                color={selected ? color.paper : color.soft}
            />
            <Text weight="medium" style={{ flex: 1 }}>
                {label}
            </Text>
            {selected ? <Icon icon={icons.check} /> : null}
        </Pressable>
    );
}

export interface TierRowProps {
    label: string;
    price: string;
    selected: boolean;
    onPress: () => void;
    /** Shows the candle tag, such as "Popular". */
    tag?: string;
}

export function TierRow({ label, price, selected, onPress, tag }: TierRowProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label}, ${price}${tag ? `, ${tag}` : ""}`}
            style={[
                styles.row,
                { justifyContent: "space-between" },
                selected ? { borderColor: color.white, backgroundColor: color.selected } : null,
            ]}
        >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text weight="medium">{label}</Text>
                {tag ? (
                    <View style={styles.tag}>
                        <Text
                            variant="caption"
                            weight="semibold"
                            style={{ fontSize: 12, lineHeight: 15, color: color.candleInk }}
                        >
                            {tag}
                        </Text>
                    </View>
                ) : null}
            </View>
            <Text weight="semibold">{price}</Text>
        </Pressable>
    );
}

export interface ToggleProps {
    value: boolean;
    onChange: (value: boolean) => void;
    accessibilityLabel: string;
}

export function Toggle({ value, onChange, accessibilityLabel }: ToggleProps) {
    const duration = useReduceMotion() ? 0 : 180;
    const knob = useAnimatedStyle(() => ({
        transform: [{ translateX: withTiming(value ? 20 : 0, { duration }) }],
        backgroundColor: withTiming(value ? color.night : color.white, { duration }),
    }));
    const track = useAnimatedStyle(() => ({
        backgroundColor: withTiming(value ? color.paper : color.rule, { duration }),
    }));
    return (
        <Pressable
            onPress={() => {
                haptic("selection");
                onChange(!value);
            }}
            accessibilityRole="switch"
            accessibilityState={{ checked: value }}
            accessibilityLabel={accessibilityLabel}
            hitSlop={8}
        >
            <Animated.View style={[styles.toggle, track]}>
                <Animated.View style={[styles.knob, knob]} />
            </Animated.View>
        </Pressable>
    );
}

export interface SliderProps {
    /** Evenly spaced stops. The thumb snaps to them, so the value is always one of these. */
    stops: readonly { value: number; label: string }[];
    value: number;
    onChange: (value: number) => void;
    accessibilityLabel: string;
    /** What a screen reader says for a value, such as "Unlimited". */
    describe?: (value: number) => string;
}

/** Where a value sits on the track, 0 to 1. A value between stops sits between them. */
function sliderPosition(stops: SliderProps["stops"], value: number): number {
    const segments = stops.length - 1;
    if (segments <= 0) return 0;
    for (let i = 0; i < segments; i++) {
        const a = stops[i]!.value;
        const b = stops[i + 1]!.value;
        if (value <= b) return (i + Math.max(0, (value - a) / (b - a))) / segments;
    }
    return 1;
}

/** The index of the stop nearest a position on the track. */
function nearestStop(stops: SliderProps["stops"], position: number): number {
    const segments = stops.length - 1;
    return Math.round(Math.min(1, Math.max(0, position)) * segments);
}

export function Slider({ stops, value, onChange, accessibilityLabel, describe }: SliderProps) {
    const [width, setWidth] = useState(0);
    const pick = (index: number) => {
        const stop = stops[Math.min(stops.length - 1, Math.max(0, index))];
        if (!stop || stop.value === value) return;
        haptic("selection");
        onChange(stop.value);
    };
    const seek = (x: number) => {
        if (width > 0) pick(nearestStop(stops, x / width));
    };
    const pan = Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin((e) => seek(e.x))
        .onUpdate((e) => seek(e.x));

    const position = sliderPosition(stops, value);
    const segments = Math.max(1, stops.length - 1);
    const above = stops.findIndex((stop) => stop.value > value);
    const below = stops.findLastIndex((stop) => stop.value < value);

    return (
        <View>
            <GestureDetector gesture={pan}>
                <View
                    onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
                    accessible
                    accessibilityRole="adjustable"
                    accessibilityLabel={accessibilityLabel}
                    accessibilityValue={{ text: describe ? describe(value) : String(value) }}
                    accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
                    onAccessibilityAction={(e) => {
                        if (e.nativeEvent.actionName === "increment" && above >= 0) pick(above);
                        if (e.nativeEvent.actionName === "decrement" && below >= 0) pick(below);
                    }}
                    style={styles.sliderHit}
                >
                    <View style={styles.sliderTrack} pointerEvents="none">
                        <View style={[styles.sliderFill, { width: `${position * 100}%` }]} />
                        <View style={[styles.sliderThumb, { left: `${position * 100}%` }]} />
                    </View>
                </View>
            </GestureDetector>
            <View style={styles.ticks} aria-hidden>
                {stops.map((stop, i) => (
                    <View
                        key={stop.value}
                        style={[styles.tick, { left: `${(i / segments) * 100}%` }]}
                    >
                        <Text variant="caption" tone="ash" align="center">
                            {stop.label}
                        </Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

// Layout

export interface ScreenProps {
    children: ReactNode;
    /** Scrolls the content. The footer stays pinned either way. */
    scroll?: boolean;
    /** Pinned to the bottom, above the home indicator, such as the main action. */
    footer?: ReactNode;
    /** Adds the 22 pt side gutter and the top spacing from the design. */
    padded?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function Screen({ children, scroll = false, footer, padded = true, style }: ScreenProps) {
    const insets = useSafeAreaInsets();
    const pad: ViewStyle = padded
        ? { paddingTop: insets.top + 12, paddingHorizontal: gutter }
        : { paddingTop: 0 };
    const bottom = Math.max(insets.bottom, 12) + 10;
    return (
        <KeyboardAvoidingView
            style={styles.screen}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
            {scroll ? (
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={[
                        pad,
                        { paddingBottom: footer ? 24 : bottom, flexGrow: 1 },
                        style,
                    ]}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                >
                    {children}
                </ScrollView>
            ) : (
                <View style={[{ flex: 1 }, pad, footer ? null : { paddingBottom: bottom }, style]}>
                    {children}
                </View>
            )}
            {footer ? (
                <View style={{ paddingHorizontal: gutter, paddingBottom: bottom, paddingTop: 12 }}>
                    {footer}
                </View>
            ) : null}
        </KeyboardAvoidingView>
    );
}

/** The five bars at the top of the create flow. */
export function Progress({ step, total = 5 }: { step: number; total?: number }) {
    return (
        <View
            style={styles.progress}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t("a11y.step", { step, total })}
            accessibilityValue={{ min: 0, max: total, now: step }}
        >
            {Array.from({ length: total }, (_, i) => (
                <ProgressBar key={i} filled={i < step} />
            ))}
        </View>
    );
}

function ProgressBar({ filled }: { filled: boolean }) {
    const duration = useReduceMotion() ? 0 : 200;
    const fill = useAnimatedStyle(() => ({
        width: withTiming(filled ? "100%" : "0%", { duration }),
    }));
    return (
        <View style={styles.progressBar}>
            <Animated.View style={[styles.progressFill, fill]} />
        </View>
    );
}

/** A section label, 15 pt Ash, with an optional value on the right. */
export function Label({ children, right }: { children: string; right?: ReactNode }) {
    return (
        <View style={styles.label}>
            <Text variant="small" tone="ash">
                {children}
            </Text>
            {right}
        </View>
    );
}

export interface KeyValueProps {
    label: string;
    value: string;
    onPress?: () => void;
}

export function KeyValue({ label, value, onPress }: KeyValueProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            accessibilityRole={onPress ? "button" : "text"}
            accessibilityLabel={`${label}, ${value}`}
            style={({ pressed }) => [styles.keyValue, { opacity: pressed ? 0.7 : 1 }]}
        >
            <Text tone="ash">{label}</Text>
            <Text weight="medium">{value}</Text>
        </Pressable>
    );
}

/** The large serif text field with the candle caret. */
export function Field(props: TextInputProps) {
    return (
        <TextInput
            placeholderTextColor={color.faint}
            selectionColor={color.candle}
            cursorColor={color.candle}
            {...props}
            style={[styles.field, props.style]}
        />
    );
}

/** A plain sans input for email and codes. */
export function Input(props: TextInputProps) {
    return (
        <TextInput
            placeholderTextColor={color.faint}
            selectionColor={color.candle}
            cursorColor={color.candle}
            {...props}
            style={[styles.input, props.style]}
        />
    );
}

export interface SheetProps {
    visible: boolean;
    onClose: () => void;
    children: ReactNode;
}

/**
 * A bottom sheet on a dimmed backdrop, as in the join screen. It closes when its screen loses
 * focus, since a modal would otherwise stay on top of the screen a link or notification opens.
 */
export function Sheet(props: SheetProps) {
    const latest = useRef(props);
    useEffect(() => {
        latest.current = props;
    });
    useFocusEffect(
        useCallback(
            () => () => {
                if (latest.current.visible) latest.current.onClose();
            },
            [],
        ),
    );
    return <ModalSheet {...props} />;
}

/** The sheet itself, for the root layout's confirm, which sits outside any screen. */
function ModalSheet({ visible, onClose, children }: SheetProps) {
    const insets = useSafeAreaInsets();
    const still = useReduceMotion();
    return (
        <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
            {visible ? (
                <KeyboardAvoidingView
                    style={{ flex: 1, justifyContent: "flex-end" }}
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                    <Animated.View
                        entering={FadeIn.duration(200)}
                        exiting={FadeOut.duration(150)}
                        style={StyleSheet.absoluteFill}
                    >
                        <Pressable
                            style={[StyleSheet.absoluteFill, styles.backdrop]}
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel={t("common.close")}
                        />
                    </Animated.View>
                    <Animated.View
                        entering={still ? FadeIn.duration(200) : SlideInDown.duration(280)}
                        exiting={still ? FadeOut.duration(150) : SlideOutDown.duration(200)}
                        style={[styles.sheet, { marginBottom: Math.max(insets.bottom - 24, 10) }]}
                    >
                        <View style={styles.grab} />
                        {children}
                    </Animated.View>
                </KeyboardAvoidingView>
            ) : null}
        </Modal>
    );
}

// Event surfaces

/** A vertical gradient over a photo, so text on it stays readable. */
export function Scrim({
    stops,
    tint = color.night,
}: {
    stops: readonly (readonly [number, number])[];
    tint?: string;
}) {
    // Gradient ids are global on the web, so each scrim gets its own.
    const id = useId().replace(/:/g, "");
    return (
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
                <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    {stops.map(([offset, opacity]) => (
                        <Stop key={offset} offset={offset} stopColor={tint} stopOpacity={opacity} />
                    ))}
                </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
    );
}

const COVER_SHADE = [
    [0, 0.2],
    [0.32, 0],
    [0.62, 0.55],
    [1, 1],
] as const satisfies readonly [number, number][];

export interface CoverProps {
    source: ImageSource | number | string | null;
    title: string;
    /** Under the title, usually a Stats row. */
    children?: ReactNode;
    height?: number;
}

/** A full-bleed photo that fades into Night, with the event name and stats over it. */
export function Cover({ source, title, children, height = 470 }: CoverProps) {
    return (
        <View style={{ height, backgroundColor: color.surface }}>
            {source !== null ? (
                <Image
                    source={source}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={200}
                    accessibilityIgnoresInvertColors
                />
            ) : null}
            <Scrim stops={COVER_SHADE} />
            <View style={styles.coverIn}>
                <Text variant="cover" align="center" accessibilityRole="header">
                    {title}
                </Text>
                {children}
            </View>
        </View>
    );
}

export interface Stat {
    value: string;
    label: string;
    onPress?: () => void;
}

export function Stats({ items }: { items: readonly Stat[] }) {
    return (
        <View style={styles.stats}>
            {items.map((item) => (
                <Pressable
                    key={item.label}
                    onPress={item.onPress}
                    disabled={!item.onPress}
                    accessibilityRole={item.onPress ? "button" : "text"}
                    accessibilityLabel={`${item.value} ${item.label}`}
                    style={{ flex: 1, alignItems: "center" }}
                >
                    <Text variant="number" align="center" numberOfLines={1}>
                        {item.value}
                    </Text>
                    <View style={styles.statLabel}>
                        <Text variant="caption" tone="soft" align="center" maxScale={CHROME_SCALE}>
                            {item.label}
                        </Text>
                        {item.onPress ? (
                            <Icon icon={icons.chevron} size={11} color={color.soft} />
                        ) : null}
                    </View>
                </Pressable>
            ))}
        </View>
    );
}

export interface TileProps {
    source?: ImageSource | number | string | null;
    /** The photographer, written in the corner after the reveal. */
    name?: string;
    /** Before the reveal: blurred or blank, with "Developing" over it. */
    developing?: boolean;
    developingLabel?: string;
    /** Moves a developing photo by this many points, so neighbouring tiles differ. */
    shift?: { x: number; y: number };
    onPress?: () => void;
    accessibilityLabel?: string;
}

/** The width of one tile in the two-column grid, which keeps a fixed gap at any screen width. */
export function useTileWidth(): number {
    const { width } = useWindowDimensions();
    return Math.floor((width - grid.side * 2 - grid.gap) / 2);
}

export function Tile({
    source = null,
    name,
    developing = false,
    developingLabel,
    shift = { x: 0, y: 0 },
    onPress,
    accessibilityLabel,
}: TileProps) {
    const width = useTileWidth();
    const label = developingLabel ?? t("event.developing");
    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            accessibilityRole={onPress ? "button" : "image"}
            accessibilityLabel={accessibilityLabel ?? (developing ? label : name)}
            style={[styles.tile, { width }]}
        >
            {source !== null ? (
                <Image
                    source={source}
                    style={[
                        StyleSheet.absoluteFill,
                        developing
                            ? {
                                  transform: [
                                      { scale: 1.5 },
                                      { translateX: shift.x },
                                      { translateY: shift.y },
                                  ],
                              }
                            : null,
                    ]}
                    contentFit="cover"
                    transition={150}
                    {...(developing ? { blurRadius: DEVELOPING_BLUR } : {})}
                />
            ) : null}
            {developing ? (
                <View style={[StyleSheet.absoluteFill, styles.developing]}>
                    <Text serif italic style={styles.developingText}>
                        {label}
                    </Text>
                </View>
            ) : name ? (
                <Text
                    serif
                    italic
                    style={styles.tileName}
                    numberOfLines={1}
                    maxScale={CHROME_SCALE}
                >
                    {name}
                </Text>
            ) : null}
        </Pressable>
    );
}

// iOS blurs in points at a smaller scale than CSS, so it needs a larger radius to look the same.
const DEVELOPING_BLUR = Platform.OS === "web" ? 18 : 42;

// Confirmations. Native screens use the system alert; the browser gets the app's own sheet
// instead of window.confirm. Either way a warning haptic marks the moment.

interface Confirmation {
    title: string;
    body: string;
    action: string;
    onConfirm: () => void;
}

let pendingConfirm: Confirmation | null = null;
const confirmListeners = new Set<() => void>();

function setConfirm(next: Confirmation | null): void {
    pendingConfirm = next;
    for (const listener of confirmListeners) listener();
}

/** Asks before something that can't be undone. */
export function confirm(title: string, body: string, action: string, onConfirm: () => void): void {
    haptic("warning");
    if (Platform.OS === "web") {
        setConfirm({ title, body, action, onConfirm });
        return;
    }
    Alert.alert(title, body, [
        { text: t("common.cancel"), style: "cancel" },
        { text: action, style: "destructive", onPress: onConfirm },
    ]);
}

/** Shows web confirmations. Rendered once, in the root layout. */
export function ConfirmHost() {
    const asking = useSyncExternalStore(
        (listener) => {
            confirmListeners.add(listener);
            return () => {
                confirmListeners.delete(listener);
            };
        },
        () => pendingConfirm,
        () => pendingConfirm,
    );
    const close = () => setConfirm(null);
    return (
        <ModalSheet visible={asking !== null} onClose={close}>
            {asking ? (
                <View style={{ gap: space.m }}>
                    <Text variant="heading" accessibilityRole="header">
                        {asking.title}
                    </Text>
                    <Text tone="ash">{asking.body}</Text>
                    <View style={{ gap: space.s, marginTop: space.s }}>
                        <Button
                            label={asking.action}
                            onPress={() => {
                                close();
                                asking.onConfirm();
                            }}
                        />
                        <Button label={t("common.cancel")} variant="dark" onPress={close} />
                    </View>
                </View>
            ) : null}
        </ModalSheet>
    );
}

/**
 * A short line for a failure: Paper with a warning icon, since Candle is kept for progress and
 * badges. It is announced when it appears.
 */
export function Notice({ children }: { children: string }) {
    useAnnounce(children);
    return (
        <View style={styles.notice}>
            <Icon icon={icons.warning} size={17} color={color.paper} />
            <Text
                variant="small"
                align="center"
                style={{ flexShrink: 1 }}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
            >
                {children}
            </Text>
        </View>
    );
}

// Toasts: a line that floats over the bottom of the screen for a few seconds, such as "Saved to
// Photos" or "Hidden from guests. Undo". Announced to screen readers.

export interface ToastAction {
    label: string;
    run: () => void;
}

interface ToastMessage {
    id: number;
    text: string;
    action: ToastAction | undefined;
}

let toast: ToastMessage | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;
const toastListeners = new Set<() => void>();

function setToast(next: ToastMessage | null): void {
    toast = next;
    for (const listener of toastListeners) listener();
}

/** Shows a toast for 3 s, or 5 s when it has an action. */
export function showToast(text: string, action?: ToastAction): void {
    if (toastTimer) clearTimeout(toastTimer);
    toastId += 1;
    setToast({ id: toastId, text, action });
    toastTimer = setTimeout(() => setToast(null), action ? 5000 : 3000);
}

export function hideToast(): void {
    if (toastTimer) clearTimeout(toastTimer);
    setToast(null);
}

/** Shows toasts. Rendered once, in the root layout. */
export function ToastHost() {
    const insets = useSafeAreaInsets();
    const current = useSyncExternalStore(
        (listener) => {
            toastListeners.add(listener);
            return () => {
                toastListeners.delete(listener);
            };
        },
        () => toast,
        () => toast,
    );
    useAnnounce(current?.text);
    if (!current) return null;
    return (
        <View
            pointerEvents="box-none"
            style={[styles.toastWrap, { bottom: Math.max(insets.bottom, space.m) + space.xxxl }]}
        >
            <Animated.View
                key={current.id}
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(180)}
                style={styles.toast}
            >
                <Text
                    variant="small"
                    style={{ flexShrink: 1 }}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                >
                    {current.text}
                </Text>
                {current.action ? (
                    <Pressable
                        onPress={() => {
                            hideToast();
                            current.action?.run();
                        }}
                        accessibilityRole="button"
                        hitSlop={10}
                    >
                        <Text variant="small" weight="semibold">
                            {current.action.label}
                        </Text>
                    </Pressable>
                ) : null}
            </Animated.View>
        </View>
    );
}

// Rows in Surface groups, as in Settings and Manage.

export interface RowProps {
    label: string;
    /** On the right, such as "On" or the event's name. */
    value?: string;
    icon?: PhosphorIcon;
    onPress?: () => void;
    /** A destructive row: Paper text with the trash icon. Candle is never used for it. */
    destructive?: boolean;
    disabled?: boolean;
    /** One line under the label, such as why a row can't change. */
    note?: string;
}

export function Row({ label, value, icon, onPress, destructive, disabled, note }: RowProps) {
    const glyph = destructive ? icons.trash : icon;
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled || !onPress}
            accessibilityRole={onPress ? "button" : "text"}
            accessibilityState={{ disabled: Boolean(disabled) }}
            accessibilityLabel={[label, value, note].filter(Boolean).join(", ")}
            style={({ pressed }) => [styles.groupRow, { opacity: pressed ? 0.7 : 1 }]}
        >
            {glyph ? <Icon icon={glyph} color={disabled ? color.faint : color.paper} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text tone={disabled ? "faint" : "paper"}>{label}</Text>
                {note ? (
                    <Text variant="small" tone="ash">
                        {note}
                    </Text>
                ) : null}
            </View>
            {value ? <Text tone="ash">{value}</Text> : null}
            {onPress && !destructive ? (
                <Icon icon={icons.chevron} size={16} color={color.ash} />
            ) : null}
        </Pressable>
    );
}

/** A Surface group of rows with dividers between them. */
export function RowGroup({ children }: { children: ReactNode }) {
    return <View style={styles.group}>{children}</View>;
}

// Images

/**
 * An image source for a signed photo URL that caches by the photo and its size, so a re-signed
 * URL for the same photo doesn't download it again.
 */
export function photoSource(url: string, id: string, size: "thumb" | "full"): ImageSource {
    return { uri: url, cacheKey: `${id}:${size}` };
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    button: {
        minHeight: 56,
        paddingVertical: 12,
        borderRadius: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        paddingHorizontal: 18,
    },
    buttonCompact: { minHeight: 48, paddingVertical: 10, borderRadius: radius.control },
    iconButton: {
        width: 48,
        height: 48,
        borderRadius: 15,
        alignItems: "center",
        justifyContent: "center",
    },
    segmented: {
        flexDirection: "row",
        backgroundColor: color.surface,
        borderRadius: 15,
        padding: 4,
    },
    segment: {
        flex: 1,
        justifyContent: "center",
        paddingVertical: 11,
        paddingHorizontal: 4,
        borderRadius: 12,
    },
    row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 17,
        paddingHorizontal: 18,
        borderRadius: 18,
        backgroundColor: color.surface,
        borderWidth: 1.5,
        borderColor: "transparent",
    },
    tag: {
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 7,
        backgroundColor: color.candle,
    },
    toggle: { width: 51, height: 31, borderRadius: 16, padding: 2 },
    knob: { width: 27, height: 27, borderRadius: 14 },
    sliderHit: { height: 44, justifyContent: "center", marginHorizontal: 6, marginTop: 4 },
    sliderTrack: { height: 5, borderRadius: 3, backgroundColor: color.track },
    sliderFill: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        borderRadius: 3,
        backgroundColor: color.paper,
    },
    sliderThumb: {
        position: "absolute",
        top: -11.5,
        width: 28,
        height: 28,
        marginLeft: -14,
        borderRadius: 14,
        backgroundColor: color.white,
        shadowColor: "#000",
        shadowOpacity: 0.5,
        shadowRadius: 5,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
    },
    // The labels sit under their stops: the same inset as the track, each centred on its stop.
    ticks: { height: 17, marginHorizontal: 6, marginTop: 2 },
    tick: { position: "absolute", top: 0, width: 40, marginLeft: -20, alignItems: "center" },
    progress: { flexDirection: "row", gap: 5 },
    progressBar: {
        flex: 1,
        height: 3.5,
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: color.track,
    },
    progressFill: { height: "100%", backgroundColor: color.paper },
    label: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginTop: 26,
        marginBottom: 10,
    },
    keyValue: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        paddingVertical: 17,
        ...divider,
    },
    field: {
        fontFamily: serifFamily(34),
        fontSize: 34,
        lineHeight: 39,
        letterSpacing: -0.34,
        color: color.paper,
        paddingTop: 8,
        paddingBottom: 14,
        borderBottomWidth: 1,
        borderBottomColor: color.rule,
    },
    input: {
        fontFamily: SANS.regular,
        fontSize: 17,
        color: color.paper,
        height: 56,
        paddingHorizontal: 18,
        borderRadius: 18,
        backgroundColor: color.surface,
    },
    backdrop: { backgroundColor: "rgba(0, 0, 0, 0.55)" },
    sheet: {
        marginHorizontal: 10,
        borderRadius: 52,
        backgroundColor: color.sheet,
        paddingTop: 12,
        paddingHorizontal: 24,
        paddingBottom: 40,
        gap: 14,
    },
    grab: {
        width: 40,
        height: 5,
        borderRadius: 3,
        backgroundColor: color.rule,
        alignSelf: "center",
        marginBottom: 6,
    },
    coverIn: { position: "absolute", left: 0, right: 0, bottom: 10, paddingHorizontal: 28 },
    stats: { flexDirection: "row", marginTop: 20 },
    notice: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: space.s,
        marginVertical: 10,
    },
    toastWrap: { position: "absolute", left: space.l, right: space.l, alignItems: "center" },
    toast: {
        flexDirection: "row",
        alignItems: "center",
        gap: space.l,
        paddingVertical: space.m,
        paddingHorizontal: space.l,
        borderRadius: radius.control,
        backgroundColor: color.raised,
        maxWidth: 480,
    },
    group: { backgroundColor: color.surface, borderRadius: radius.row, paddingHorizontal: space.l },
    groupRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        minHeight: 52,
        paddingVertical: space.m,
        ...divider,
    },
    statLabel: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
    tile: {
        aspectRatio: 3 / 4,
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: color.tile,
    },
    developing: {
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(13, 13, 13, 0.15)",
    },
    developingText: { fontSize: 20, lineHeight: 24, color: "rgba(255, 255, 255, 0.85)" },
    tileName: {
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 9,
        fontSize: 19,
        lineHeight: 23,
        color: color.white,
        textShadowColor: "rgba(0, 0, 0, 0.7)",
        textShadowRadius: 10,
    },
});
