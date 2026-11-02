import { defineConfig } from "astro/config";

export default defineConfig({
    site: "https://lingercam.app",
    output: "static",
    trailingSlash: "always",
    server: { host: "127.0.0.1", port: 8170 },
    devToolbar: { enabled: false },
});
