import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

function forbidImports(names, message) {
    return {
        "no-restricted-imports": [
            "error",
            {
                patterns: [
                    { regex: `^(@linger/)?(${names})(/|$)`, message },
                    { regex: `^(\\.\\./)+(apps/)?(${names})(/|$)`, message },
                ],
            },
        ],
    };
}

const appRule = "Apps never import other apps. Shared rules belong in packages/core.";

export default tseslint.config(
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.expo/**",
            "**/.astro/**",
            "**/ios/**",
            "**/android/**",
            "**/expo-env.d.ts",
            "**/drizzle/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ["**/*.{ts,tsx}"],
        plugins: { "react-hooks": reactHooks },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/consistent-type-imports": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "no-console": "error",
            "no-void": "error",
        },
    },
    {
        files: ["**/*.{js,cjs,mjs}"],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        files: ["apps/api/**"],
        rules: forbidImports("app|site", appRule),
    },
    {
        files: ["apps/app/**"],
        rules: forbidImports("api|site", appRule),
    },
    {
        // React Native bundles images and fonts through require().
        files: ["apps/app/**"],
        rules: {
            "@typescript-eslint/no-require-imports": [
                "error",
                { allow: ["\\.(png|jpe?g|otf|ttf)$"] },
            ],
        },
    },
    {
        files: ["apps/app/metro.config.js"],
        rules: { "@typescript-eslint/no-require-imports": "off" },
    },
    {
        files: ["apps/site/**"],
        rules: forbidImports("api|app", appRule),
    },
    {
        files: ["packages/core/**"],
        rules: {
            "no-restricted-imports": [
                "error",
                {
                    patterns: [
                        {
                            regex: "^(\\.\\./)+(apps|packages)?(/|$)",
                            message: "core imports nothing from the repo.",
                        },
                        {
                            regex: "^(@linger/|api$|app$|site$|react|expo|hono|drizzle|pg-boss)",
                            message: "core is plain TypeScript with no app, React or server code.",
                        },
                    ],
                },
            ],
        },
    },
);
