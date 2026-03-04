const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Reduce the number of watched files to avoid EMFILE on macOS 12
config.watchFolders = [__dirname];
config.resolver.blockList = [
    /node_modules\/.*\/node_modules\/.*/,
];

module.exports = config;
