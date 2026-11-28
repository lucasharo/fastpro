// Configuracao do app FastPro (Android e iOS). Valores de ambiente: apps/mobile/.env (ver .env.example).
const { existsSync } = require('node:fs');

const ID = 'br.com.fastpro.app';
const googleServices = './google-services.json';

module.exports = {
  expo: {
    name: 'FastPro',
    slug: 'fastpro',
    scheme: 'fastpro',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: ID,
      supportsTablet: true,
    },
    android: {
      package: ID,
      // Push no Android: o arquivo do projeto Firebase fica fora do Git.
      ...(existsSync(`${__dirname}/google-services.json`) ? { googleServicesFile: googleServices } : {}),
    },
    plugins: ['expo-notifications'],
    extra: {
      ...(process.env.EAS_PROJECT_ID ? { eas: { projectId: process.env.EAS_PROJECT_ID } } : {}),
    },
  },
};
