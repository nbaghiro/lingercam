import { Newsreader_400Regular } from "@expo-google-fonts/newsreader/400Regular";
import { Newsreader_400Regular_Italic } from "@expo-google-fonts/newsreader/400Regular_Italic";
import { Image, type ImageSource } from "expo-image";
import type { Occasion } from "@linger/core/events";
import { AirplaneTiltIcon } from "phosphor-react-native/src/icons/AirplaneTilt";
import { ArrowLeftIcon } from "phosphor-react-native/src/icons/ArrowLeft";
import { CakeIcon } from "phosphor-react-native/src/icons/Cake";
import { CameraIcon } from "phosphor-react-native/src/icons/Camera";
import { CameraRotateIcon } from "phosphor-react-native/src/icons/CameraRotate";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { ChampagneIcon } from "phosphor-react-native/src/icons/Champagne";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
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
import { XIcon } from "phosphor-react-native/src/icons/X";
import type { Icon as PhosphorIcon, IconWeight } from "phosphor-react-native";
import { useId, useState, type ReactNode } from "react";
import {
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
    type StyleProp,
    type TextInputProps,
    type TextStyle,
    type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import QRCode from "react-native-qrcode-svg";
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

export const FONTS = {
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    "Pretendard-Regular": require("../assets/fonts/Pretendard-Regular.otf"),
    "Pretendard-Medium": require("../assets/fonts/Pretendard-Medium.otf"),
    "Pretendard-SemiBold": require("../assets/fonts/Pretendard-SemiBold.otf"),
    "Pretendard-Bold": require("../assets/fonts/Pretendard-Bold.otf"),
};

const SANS = {
    regular: "Pretendard-Regular",
    medium: "Pretendard-Medium",
    semibold: "Pretendard-SemiBold",
    bold: "Pretendard-Bold",
} as const;

export const gutter = 22;

// Text

interface Variant {
    serif: boolean;
    italic?: boolean;
    fontSize: number;
    lineHeight: number;
    letterSpacing?: number;
}

const VARIANTS = {
    /** Serif 42, screen titles like "What are we capturing?" */
    display: { serif: true, fontSize: 42, lineHeight: 44.5, letterSpacing: -0.84 },
    /** Serif 33, step and section titles. */
    title: { serif: true, fontSize: 33, lineHeight: 36.3, letterSpacing: -0.5 },
    /** Serif 38, the event name over its cover. */
    cover: { serif: true, fontSize: 38, lineHeight: 40, letterSpacing: -0.57 },
    /** Serif 30, the name on the invite card and sheet titles. */
    heading: { serif: true, fontSize: 30, lineHeight: 33, letterSpacing: -0.3 },
    /** Serif 21, card titles and the camera header. */
    name: { serif: true, fontSize: 21, lineHeight: 25 },
    /** Serif italic 27, numbers in the stat row. */
    number: { serif: true, italic: true, fontSize: 27, lineHeight: 30 },
    /** Sans 17, rows and controls. */
    body: { serif: false, fontSize: 17, lineHeight: 23 },
    /** Sans 15, supporting text. */
    small: { serif: false, fontSize: 15, lineHeight: 21.75 },
    /** Sans 13, captions and tick labels. */
    caption: { serif: false, fontSize: 13, lineHeight: 17 },
} as const satisfies Record<string, Variant>;

export type TextVariant = keyof typeof VARIANTS;
export type Tone = "paper" | "ash" | "faint" | "candle" | "ink" | "soft" | "white";

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
    accessibilityRole?: "header" | "text" | "link";
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
}: TextProps) {
    const v: Variant = VARIANTS[variant];
    const isSerif = serif ?? v.serif;
    const isItalic = italic ?? v.italic ?? false;
    const fontFamily = isSerif
        ? isItalic
            ? "Newsreader_400Regular_Italic"
            : "Newsreader_400Regular"
        : SANS[weight];
    return (
        <RNText
            {...(numberOfLines !== undefined ? { numberOfLines } : {})}
            {...(accessibilityRole ? { accessibilityRole } : {})}
            style={[
                {
                    fontFamily,
                    fontSize: v.fontSize,
                    lineHeight: v.lineHeight,
                    letterSpacing: v.letterSpacing ?? 0,
                    color: color[tone === "white" ? "white" : tone],
                },
                align ? { textAlign: align } : null,
                style,
            ]}
        >
            {children}
        </RNText>
    );
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
            <RNText
                style={{
                    fontFamily: "Newsreader_400Regular",
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
    const fg = primary ? color.ink : color.paper;
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
                    backgroundColor: primary
                        ? color.cream
                        : variant === "glass"
                          ? color.glass
                          : color.raised,
                    opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
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
                        <Text weight="semibold" style={{ color: fg }}>
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
                    opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
                },
                style,
            ]}
        >
            <Icon icon={icon} />
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
                        onPress={() => onChange(option.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        style={[styles.segment, on ? { backgroundColor: color.segment } : null]}
                    >
                        <Text
                            variant="small"
                            tone={on ? "paper" : "ash"}
                            weight={on ? "medium" : "regular"}
                            align="center"
                            numberOfLines={1}
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
    const knob = useAnimatedStyle(() => ({
        transform: [{ translateX: withTiming(value ? 20 : 0, { duration: 180 }) }],
        backgroundColor: withTiming(value ? color.night : color.white, { duration: 180 }),
    }));
    const track = useAnimatedStyle(() => ({
        backgroundColor: withTiming(value ? color.paper : color.rule, { duration: 180 }),
    }));
    return (
        <Pressable
            onPress={() => onChange(!value)}
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
    /** Evenly spaced stops; values between two stops are spread linearly between them. */
    stops: readonly { value: number; label: string }[];
    value: number;
    onChange: (value: number) => void;
    accessibilityLabel: string;
    /** What a screen reader says for a value, such as "Unlimited". */
    describe?: (value: number) => string;
}

function sliderPosition(stops: SliderProps["stops"], value: number): number {
    const segments = stops.length - 1;
    for (let i = 0; i < segments; i++) {
        const a = stops[i]!.value;
        const b = stops[i + 1]!.value;
        if (value <= b) return (i + Math.max(0, (value - a) / (b - a))) / segments;
    }
    return 1;
}

function sliderValue(stops: SliderProps["stops"], position: number): number {
    const segments = stops.length - 1;
    const p = Math.min(1, Math.max(0, position)) * segments;
    const i = Math.min(segments - 1, Math.floor(p));
    const a = stops[i]!.value;
    const b = stops[i + 1]!.value;
    return Math.round(a + (b - a) * (p - i));
}

export function Slider({ stops, value, onChange, accessibilityLabel, describe }: SliderProps) {
    const [width, setWidth] = useState(0);
    const seek = (x: number) => {
        if (width > 0) onChange(sliderValue(stops, x / width));
    };
    const pan = Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin((e) => seek(e.x))
        .onUpdate((e) => seek(e.x));

    const min = stops[0]?.value ?? 0;
    const max = stops[stops.length - 1]?.value ?? 0;
    const position = sliderPosition(stops, value);

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
                        const step = e.nativeEvent.actionName === "increment" ? 1 : -1;
                        onChange(Math.min(max, Math.max(min, value + step)));
                    }}
                    style={styles.sliderHit}
                >
                    <View style={styles.sliderTrack} pointerEvents="none">
                        <View style={[styles.sliderFill, { width: `${position * 100}%` }]} />
                        <View style={[styles.sliderThumb, { left: `${position * 100}%` }]} />
                    </View>
                </View>
            </GestureDetector>
            <View style={styles.ticks}>
                {stops.map((stop) => (
                    <Text key={stop.value} variant="caption" tone="faint">
                        {stop.label}
                    </Text>
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
            accessibilityValue={{ min: 0, max: total, now: step }}
        >
            {Array.from({ length: total }, (_, i) => (
                <View
                    key={i}
                    style={[styles.progressBar, i < step ? { backgroundColor: color.paper } : null]}
                />
            ))}
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

/** A bottom sheet on a dimmed backdrop, as in the join screen. */
export function Sheet({ visible, onClose, children }: SheetProps) {
    const insets = useSafeAreaInsets();
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
                        entering={SlideInDown.duration(280)}
                        exiting={SlideOutDown.duration(200)}
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
                    <Text variant="caption" tone="soft" align="center">
                        {item.label}
                    </Text>
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

export function Tile({
    source = null,
    name,
    developing = false,
    developingLabel = "Developing",
    shift = { x: 0, y: 0 },
    onPress,
    accessibilityLabel,
}: TileProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            accessibilityRole={onPress ? "button" : "image"}
            accessibilityLabel={accessibilityLabel ?? (developing ? developingLabel : name)}
            style={styles.tile}
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
                        {developingLabel}
                    </Text>
                </View>
            ) : name ? (
                <Text serif italic style={styles.tileName} numberOfLines={1}>
                    {name}
                </Text>
            ) : null}
        </Pressable>
    );
}

// iOS blurs in points at a smaller scale than CSS, so it needs a larger radius to look the same.
const DEVELOPING_BLUR = Platform.OS === "web" ? 18 : 42;

/** The QR code's drawing, which can render itself to a base64 PNG for printing. */
export interface QrHandle {
    toDataURL: (callback: (base64Png: string) => void) => void;
}

export interface InviteCardProps {
    title: string;
    url: string;
    caption: string;
    size?: number;
    qrRef?: (ref: QrHandle | null) => void;
}

/** The cream card with the mark, a real QR code for the join link, and the event name. */
export function InviteCard({ title, url, caption, size = 220, qrRef }: InviteCardProps) {
    return (
        <View style={styles.inviteCard} accessible accessibilityLabel={`${title}. ${caption}`}>
            <Mark size={26} tint={color.ink} />
            <View style={{ marginTop: 18, marginBottom: 16 }}>
                <QRCode
                    value={url}
                    size={size}
                    color={color.ink}
                    backgroundColor={color.cream}
                    {...(qrRef ? { getRef: (ref: QrHandle | null) => qrRef(ref) } : {})}
                />
            </View>
            <Text variant="heading" align="center" style={{ color: color.ink }}>
                {title}
            </Text>
            <Text variant="small" tone="faint" align="center" style={{ marginTop: 8 }}>
                {caption}
            </Text>
        </View>
    );
}

/** Asks before something that can't be undone. The browser has no styled alert, so it uses its own. */
export function confirm(title: string, body: string, action: string, onConfirm: () => void): void {
    if (Platform.OS === "web") {
        if (globalThis.confirm?.(`${title}\n\n${body}`)) onConfirm();
        return;
    }
    Alert.alert(title, body, [
        { text: t("common.cancel"), style: "cancel" },
        { text: action, style: "destructive", onPress: onConfirm },
    ]);
}

/** A short line for a failure, in Candle so it stands apart from body text. */
export function Notice({ children }: { children: string }) {
    return (
        <Text
            variant="small"
            tone="candle"
            align="center"
            style={{ marginVertical: 10 }}
            accessibilityRole="text"
        >
            {children}
        </Text>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.night },
    button: {
        height: 56,
        borderRadius: 18,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        paddingHorizontal: 18,
    },
    buttonCompact: { height: 48, borderRadius: 15 },
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
    segment: { flex: 1, paddingVertical: 11, paddingHorizontal: 4, borderRadius: 12 },
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
    ticks: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
    progress: { flexDirection: "row", gap: 5 },
    progressBar: { flex: 1, height: 3.5, borderRadius: 2, backgroundColor: color.track },
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
        borderBottomWidth: StyleSheet.hairlineWidth * 2,
        borderBottomColor: color.line,
    },
    field: {
        fontFamily: "Newsreader_400Regular",
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
    tile: {
        width: "48.9%",
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
    inviteCard: {
        backgroundColor: color.cream,
        borderRadius: 32,
        paddingTop: 28,
        paddingHorizontal: 24,
        paddingBottom: 24,
        alignItems: "center",
        marginVertical: 22,
    },
});
