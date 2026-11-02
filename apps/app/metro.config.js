// Expo detects the pnpm workspace and watches the monorepo root on its own.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
