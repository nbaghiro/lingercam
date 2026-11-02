import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "postgresql",
    schema: "./src/db.ts",
    out: "./drizzle",
    dbCredentials: {
        url: process.env.DATABASE_URL ?? "postgres://linger:linger@localhost:8172/linger",
    },
});
