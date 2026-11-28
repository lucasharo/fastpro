// Os tokens de cor e tipografia vem de packages/tokens (unica fonte); o app e instalado fora do workspace pnpm.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../packages/tokens/src')];

module.exports = config;
