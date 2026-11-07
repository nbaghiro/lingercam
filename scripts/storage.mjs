// Chooses where the local API keeps photos. `pnpm storage:r2` writes .env.r2, which points the
// API and the seed at the lingercam-dev bucket on Cloudflare R2, so the demo events are served the
// way production serves them. `pnpm storage:local` removes it and goes back to the RustFS
// container. The R2 keys come from R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in
// .env. Restart the API and reseed after switching. See .docs/demo-accounts.md.
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const R2_ENV = new URL(".env.r2", ROOT);
const BUCKET = "lingercam-dev";

function fromEnv(key) {
    const env = readFileSync(new URL(".env", ROOT), "utf8");
    const value = env.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
    if (!value) throw new Error(`Set ${key} in .env first.`);
    return value;
}

const command = process.argv[2];
if (command === "r2") {
    const account = fromEnv("R2_ACCOUNT_ID");
    writeFileSync(
        R2_ENV,
        [
            "# Written by `pnpm storage:r2`; `pnpm storage:local` removes it.",
            `S3_ENDPOINT=https://${account}.r2.cloudflarestorage.com`,
            "S3_REGION=auto",
            `S3_BUCKET=${BUCKET}`,
            `S3_ACCESS_KEY_ID=${fromEnv("R2_ACCESS_KEY_ID")}`,
            `S3_SECRET_ACCESS_KEY=${fromEnv("R2_SECRET_ACCESS_KEY")}`,
            // Phones reach R2 directly, so signed URLs no longer need this Mac's address.
            "S3_PUBLIC_ENDPOINT=",
            "",
        ].join("\n"),
    );
    console.log(`Photos now go to R2 (${BUCKET}). Restart the API, then reseed:`);
    console.log("  pnpm --filter api dev");
    console.log("  pnpm --filter api seed");
} else if (command === "local") {
    rmSync(R2_ENV, { force: true });
    console.log("Photos now go to local storage. Restart the API, then reseed.");
} else {
    console.log("Usage: node scripts/storage.mjs r2|local");
    process.exitCode = 1;
}
