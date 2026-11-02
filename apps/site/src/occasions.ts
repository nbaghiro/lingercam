// The demo events the site's phones show, one per occasion pill.

export interface Occasion {
    label: string;
    icon: string;
    title: string;
    short: string;
    hero: string;
    vf: string;
    reveal: string;
    lock: string;
    grid: string[];
    moments: string;
    /** Where the open photo sits in the gallery, as the viewer shows it. */
    index: string;
    left: string;
    people: string;
    when: string;
    day: string;
    date: string;
    ends: string;
    tier: number;
}

export const OCCASIONS = {
    wedding: {
        label: "Wedding",
        icon: "heart",
        title: "Emma & Daniel's Wedding day",
        short: "Emma & Daniel's Wedding",
        hero: "w-hero",
        vf: "w-dog",
        reveal: "w-sil",
        lock: "w-lights",
        grid: [
            "w-toast",
            "w-speech",
            "w-dance",
            "w-clink",
            "w-tear",
            "w-bw",
            "w-elders",
            "w-walk",
            "w-crowd",
            "w-bouquet",
        ],
        moments: "4,293",
        index: "1,204",
        left: "1d 23m",
        people: "203",
        when: "tomorrow at 10:00",
        day: "Tomorrow",
        date: "Saturday 14 June",
        ends: "Sunday, 1:00",
        tier: 3,
    },
    birthday: {
        label: "Birthday",
        icon: "cake",
        title: "Maya turns thirty",
        short: "Maya turns thirty",
        hero: "b-hero",
        vf: "b-cake",
        reveal: "b-laugh",
        lock: "b-table",
        grid: ["b-laugh", "b-cup", "b-hug", "b-table", "b-cake", "p-cheer", "p-group", "p-couch"],
        moments: "612",
        index: "212",
        left: "6h 10m",
        people: "34",
        when: "tomorrow at 11:00",
        day: "Tomorrow",
        date: "Friday 3 October",
        ends: "Tonight, 2:00",
        tier: 2,
    },
    trip: {
        label: "Trip",
        icon: "airplane-tilt",
        title: "Tofino, the long weekend",
        short: "Tofino weekend",
        hero: "t-lie",
        vf: "t-drive",
        reveal: "t-hero",
        lock: "t-hero",
        grid: ["t-van", "t-door", "t-drive", "t-hero", "t-lie", "e-couple"],
        moments: "1,048",
        index: "386",
        left: "2d 4h",
        people: "9",
        when: "Monday at 20:00",
        day: "Monday",
        date: "Saturday 2 August",
        ends: "Monday, 18:00",
        tier: 0,
    },
    party: {
        label: "Party",
        icon: "champagne",
        title: "Jun's housewarming",
        short: "Jun's housewarming",
        hero: "p-hero",
        vf: "p-cheer",
        reveal: "p-group",
        lock: "p-couch",
        grid: ["p-couch", "p-group", "p-dance", "p-hug", "p-cheer", "b-cup"],
        moments: "387",
        index: "141",
        left: "4h 32m",
        people: "41",
        when: "tomorrow at 12:00",
        day: "Tomorrow",
        date: "Saturday 22 November",
        ends: "Tonight, 1:00",
        tier: 2,
    },
    everyday: {
        label: "Just everyday",
        icon: "sun-horizon",
        title: "Sunday dinners with the Okafors",
        short: "Sunday dinners",
        hero: "e-hero",
        vf: "e-couple",
        reveal: "e-fiesta",
        lock: "e-fiesta",
        grid: ["e-fiesta", "w-elders", "b-table", "e-couple", "p-hug", "b-hug"],
        moments: "164",
        index: "58",
        left: "3h 05m",
        people: "12",
        when: "tonight at 21:00",
        day: "Tonight",
        date: "Sunday 9 November",
        ends: "Tonight, 21:00",
        tier: 1,
    },
} satisfies Record<string, Occasion>;

export type OccasionKey = keyof typeof OCCASIONS;

export const OCCASION_KEYS = Object.keys(OCCASIONS) as OccasionKey[];

export const FIRST_OCCASION: OccasionKey = "wedding";

export const NAMES = [
    "Sofia M.",
    "Jun K.",
    "Ade O.",
    "Priya R.",
    "Tom B.",
    "Lena W.",
    "Marco D.",
    "Hana S.",
    "Theo P.",
    "Ines L.",
];

export function photo(name: string): string {
    return `/photos/${name}.jpg`;
}
