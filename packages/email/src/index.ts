// H-093 | @fastpro/email: adaptadores de e-mail atras de EmailProviderPort (docs/factory/37-DESENHO-H093.md).
export const PACKAGE_NAME = '@fastpro/email' as const;

export * from './env.js';
export * from './errors.js';
export * from './address.js';
export * from './idempotency.js';
export * from './renderer.js';
export * from './auth-renderer.js';
export * from './transports.js';
export * from './resend.js';
export * from './mailpit.js';
export * from './select.js';
