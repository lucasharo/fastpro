// H-093 | @fastpro/email: adaptadores de e-mail atras de EmailProviderPort (docs/factory/37-DESENHO-H093.md).
export const PACKAGE_NAME = '@fastpro/email' as const;

export * from './env.js';
export * from './errors.js';
export * from './address.js';
export * from './idempotency.js';
export * from './renderer.js';
export * from './auth-renderer.js';
// H-016 | Modelos versionados do profissional (verificacao, recuperacao, ativacao e aviso de senha alterada).
export * from './professional-renderer.js';
// H-016 | Adaptador das portas de recuperacao e de aviso para os modelos (sink desligado ou de captura).
export * from './professional-mail.js';
// H-099 (Issue 109) | Modelos dos lembretes de prazo (pedido) e de trial (desenho 163 §6). Sem envio.
export * from './reminder-renderer.js';
// Pacote D (H-095, H-096, H-098) | Modelos dos avisos do ciclo central (aceite, mensagem, selecao, cancelamento). Sem envio.
export * from './cycle-renderer.js';
export * from './transports.js';
export * from './resend.js';
export * from './destination.js';
export * from './select.js';
