// Chooses which backend the app on a phone talks to. `pnpm device:on` points the local stack at
// this Mac's Wi-Fi address, `pnpm device:staging` and `pnpm device:prod` point the app at a
// deployed backend, and `pnpm device:off` puts everything back on localhost. See .docs/device-testing.md.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";

const ROOT = new URL("../", import.meta.url);
const SERVER_ENV = new URL(".env.device", ROOT);
const APP_ENV = new URL("apps/app/.env.local", ROOT);
const COMPOSE = ["compose", "-f", "docker-compose.yml"];

/** The Mac's private IPv4 address on Wi-Fi or Ethernet. */
function lanAddress() {
    const candidates = Object.entries(networkInterfaces())
        .filter(([name]) => name.startsWith("en"))
        .flatMap(([, addresses]) => addresses ?? [])
        .filter((a) => a.family === "IPv4" && !a.internal)
        .map((a) => a.address)
        .filter((ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
    if (candidates.length === 0) throw new Error("No Wi-Fi or Ethernet address found.");
    return candidates[0];
}

/** CORS_ORIGINS from .env, so localhost keeps working beside the LAN address. */
function baseOrigins() {
    const env = readFileSync(new URL(".env", ROOT), "utf8");
    return (
        env
            .match(/^CORS_ORIGINS=(.*)$/m)?.[1]
            ?.split(",")
            .filter(Boolean) ?? []
    );
}

const URL_KEYS = ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_JOIN_URL", "EXPO_PUBLIC_SITE_URL"];

/** Sets or clears the app's backend addresses, keeping anything else, such as APPLE_TEAM_ID. */
function writeAppEnv(urls) {
    const kept = existsSync(APP_ENV)
        ? readFileSync(APP_ENV, "utf8")
              .split("\n")
              .filter((line) => line && !URL_KEYS.some((key) => line.startsWith(`${key}=`)))
              .filter((line) => !line.startsWith("# Backend:") && !line.startsWith("# Written by"))
        : [];
    const lines = urls
        ? [
              `# Backend: ${urls.label}, set by \`pnpm device:${urls.command}\`.`,
              `EXPO_PUBLIC_API_URL=${urls.api}`,
              `EXPO_PUBLIC_JOIN_URL=${urls.join}`,
              `EXPO_PUBLIC_SITE_URL=${urls.site}`,
          ]
        : [];
    const all = [...kept, ...lines];
    if (all.length === 0) rmSync(APP_ENV, { force: true });
    else writeFileSync(APP_ENV, `${all.join("\n")}\n`);
}

function compose(...files) {
    execFileSync("docker", [...COMPOSE, ...files, "up", "-d", "storage"], {
        cwd: ROOT,
        stdio: "inherit",
    });
}

const command = process.argv[2];
if (command === "on") {
    const ip = lanAddress();
    const api = `http://${ip}:8171`;
    const join = `http://${ip}:8173`;
    const site = `http://${ip}:8170`;
    const origins = [...new Set([...baseOrigins(), join, site])].join(",");
    writeFileSync(
        SERVER_ENV,
        [
            "# Written by `pnpm device:on` for testing on a phone; `pnpm device:off` removes it.",
            `API_URL=${api}`,
            `JOIN_URL=${join}`,
            `SITE_URL=${site}`,
            `S3_PUBLIC_ENDPOINT=http://${ip}:8174`,
            `CORS_ORIGINS=${origins}`,
            "",
        ].join("\n"),
    );
    writeAppEnv({ label: `this Mac at ${ip}`, command: "on", api, join, site });
    compose("-f", "docker-compose.device.yml");
    process.stdout.write(
        [
            "",
            `The local stack now uses ${ip}. Restart the API and start Metro with --clear,`,
            "so both pick up the new addresses:",
            "  pnpm --filter api dev",
            "  pnpm --filter app start --clear",
            "",
        ].join("\n"),
    );
} else if (command === "staging" || command === "prod") {
    const file = command === "staging" ? "staging.json" : "production.json";
    const label = command === "staging" ? "staging on Render" : "production";
    const urls = JSON.parse(readFileSync(new URL(`scripts/${file}`, ROOT), "utf8"));
    writeAppEnv({ label, command, ...urls });
    process.stdout.write(
        [
            "",
            `The app now uses ${label} at ${urls.api}.`,
            "Restart Metro with --clear: pnpm --filter app start --clear",
            "",
        ].join("\n"),
    );
} else if (command === "off") {
    rmSync(SERVER_ENV, { force: true });
    writeAppEnv(null);
    compose();
    process.stdout.write("\nBack on localhost. Restart the API and Metro (--clear).\n");
} else {
    process.stdout.write("Usage: node scripts/device.mjs on|staging|prod|off\n");
    process.exitCode = 1;
}
