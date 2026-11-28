// H-102 | Logica pura do script local de primeiro Superadmin (docs/factory/54-DESENHO-H102.md §6).
// Sem conexao e sem processo: argumentos, travas (antes de qualquer conexao), cifra do e-mail no formato
// de challenges-crypto (versao 1, nonce 12, tag 16, AES-256-GCM, AAD do convite), HMAC do e-mail e link.
// Nunca guarda nem imprime valor de variavel de ambiente, senha, chave, pepper ou host.
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

export const BOOTSTRAP_MODES = ['primeiro', 'continuidade'];
/** Somente ambiente local (lista de .env.example: local, test, preview, staging, production). */
export const BOOTSTRAP_ENV_ALLOWED = ['local'];
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Le os argumentos. Sem bibliotecas; valor ausente vira nulo (a trava recusa depois). */
export function parseBootstrapArgs(argv) {
  const out = { email: null, modo: 'primeiro', confirmarHost: null, reemitir: false, extras: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i] ?? null;
    else if (a === '--modo') out.modo = argv[++i] ?? null;
    else if (a === '--confirmar-host') out.confirmarHost = argv[++i] ?? null;
    else if (a === '--reemitir') out.reemitir = true;
    else out.extras.push(a);
  }
  return out;
}

/** Host do banco a partir da URL de conexao. Nulo se a URL nao puder ser lida (nada e impresso). */
export function hostOfDbUrl(dbUrl) {
  try {
    return new URL(dbUrl).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Trava antes de qualquer conexao. Devolve null se pode seguir, ou {codigo, mensagem} com um texto
 * que nunca traz valores do ambiente (so nomes de variaveis e codigos).
 */
export function bootstrapRefusal(args, env, dbUrl) {
  if (args.extras.length > 0) return recusa('argumento_desconhecido', 'argumento desconhecido');
  if (args.email === null || !EMAIL_FORMAT.test(args.email.trim().toLowerCase())) {
    return recusa('email_invalido', 'informe --email com um endereco valido');
  }
  if (!BOOTSTRAP_MODES.includes(args.modo)) {
    return recusa('modo_invalido', 'use --modo primeiro ou --modo continuidade');
  }
  if (!BOOTSTRAP_ENV_ALLOWED.includes(env.APP_ENV ?? '')) {
    return recusa('ambiente_nao_permitido', 'o script roda somente com APP_ENV=local (desenvolvimento)');
  }
  if (typeof dbUrl !== 'string' || dbUrl === '') {
    return recusa('banco_nao_configurado', 'DATABASE_URL_MIGRATIONS ausente (ambiente ou .env.local)');
  }
  if (args.confirmarHost === null || args.confirmarHost === '') {
    return recusa('host_nao_confirmado', 'informe --confirmar-host com o host do banco de desenvolvimento');
  }
  const host = hostOfDbUrl(dbUrl);
  if (host === null || host !== args.confirmarHost) {
    return recusa('host_diferente', 'o host do banco nao e o informado em --confirmar-host');
  }
  for (const nome of ['PEPPER_EMAIL_HMAC', 'AUTH_CHALLENGE_KEY', 'ADMIN_BASE_URL']) {
    if (!env[nome]) return recusa('configuracao_ausente', `variavel ausente: ${nome}`);
  }
  return null;
}

function recusa(codigo, mensagem) {
  return { codigo, mensagem };
}

/** Link do convite: ${ADMIN_BASE_URL}/convite#t=<token>. O token fica so no fragmento. */
export function buildInviteLink(baseUrl, token) {
  return `${baseUrl.replace(/\/+$/, '')}/convite#t=${token}`;
}

/** HMAC-SHA256 hex do e-mail normalizado (mesma chave de challengeHmacHex). */
export function adminEmailHmac(pepper, email) {
  return createHmac('sha256', pepper).update(email, 'utf8').digest('hex');
}

/** SHA-256 hex do token: so o hash vai ao banco. */
export function adminTokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Chave AES-256 a partir de AUTH_CHALLENGE_KEY (base64 de 32 bytes). Nulo se invalida (sem valor). */
export function adminCipherKey(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const key = Buffer.from(raw.trim(), 'base64');
  return key.length === 32 ? key : null;
}

/**
 * Cifra o e-mail do convite no mesmo formato que challenges-crypto (versao 1 | nonce | tag | corpo).
 * AAD: admin_invite|<id>|email_enc, para que o blob so abra no convite de origem.
 */
export function sealAdminInviteEmail(key, plain, inviteId) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`admin_invite|${inviteId}|email_enc`, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), body]);
}
