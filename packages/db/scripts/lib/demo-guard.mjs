// H-120 (Issue 129) | Trava de ambiente da carga de demonstracao e chaves de teste locais.
// Funcoes puras (sem banco, sem rede, sem imprimir valores). Ver 85-DESENHO-H120 §1.
//  - FASTPRO_DEMO_ALLOW precisa ser exatamente "local" (qualquer outro valor ou ausencia = recusa).
//  - O host de DATABASE_URL_MIGRATIONS precisa ser 127.0.0.1, localhost ou ::1. Host remoto e
//    recusado sempre (inclusive *.supabase.co e *.pooler.supabase.com), com ou sem a variavel.
//  - Parametro host/hostaddr na URL e recusado (o driver usaria o host do parametro).
// Recusa: { codigo, mensagem }. Nenhuma mensagem contem valor de conexao ou de chave.
import { Buffer } from 'node:buffer';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export const DEMO_ALLOW_VALUE = 'local';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const ADDRESS_KEY_MIN = 32;
const FORMAT_PREFIX = 'doc1';

function recusa(codigo, mensagem) {
  return { codigo, mensagem };
}

/** Host de uma URL de conexao, sem colchetes. null se a URL nao puder ser lida. */
export function hostOfDbUrl(dbUrl) {
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    return null;
  }
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/** Ref do projeto Supabase (20 caracteres minusculos) a partir da URL publica do .env.local. */
export function projectRefOf(supabaseUrl) {
  const m = typeof supabaseUrl === 'string' ? supabaseUrl.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/) : null;
  return m ? m[1] : null;
}

/**
 * Trava de ambiente. Devolve null quando a carga pode prosseguir.
 * Aceita (decisao 58): banco local com FASTPRO_DEMO_ALLOW="local"; OU o banco de DESENVOLVIMENTO
 * do proprio projeto (APP_ENV="development", ref do projeto na URL do banco igual ao ref de
 * NEXT_PUBLIC_SUPABASE_URL). Qualquer outro host, ambiente ou parametro e recusado.
 */
export function demoGuardRefusal(env, dbUrl) {
  if (typeof dbUrl !== 'string' || dbUrl === '') {
    return recusa('banco_nao_configurado', 'DATABASE_URL_MIGRATIONS ausente (ambiente ou .env.local)');
  }
  const host = hostOfDbUrl(dbUrl);
  if (host === null) return recusa('banco_invalido', 'DATABASE_URL_MIGRATIONS nao pode ser lida');
  let params;
  let usuario;
  try {
    const u = new URL(dbUrl);
    params = u.searchParams;
    usuario = decodeURIComponent(u.username);
  } catch {
    return recusa('banco_invalido', 'DATABASE_URL_MIGRATIONS nao pode ser lida');
  }
  if (params.has('host') || params.has('hostaddr')) {
    return recusa('host_nao_local', 'a URL traz parametro de host; use somente host local ou o banco de desenvolvimento');
  }
  if (LOCAL_HOSTS.has(host)) {
    if (env.FASTPRO_DEMO_ALLOW !== DEMO_ALLOW_VALUE) {
      return recusa('ambiente_nao_permitido', 'banco local exige FASTPRO_DEMO_ALLOW exatamente "local"');
    }
    return null;
  }
  // Banco de desenvolvimento do projeto: APP_ENV=development e o mesmo ref do NEXT_PUBLIC_SUPABASE_URL.
  const ref = projectRefOf(env.NEXT_PUBLIC_SUPABASE_URL);
  const noProjeto = ref !== null && (host.includes(ref) || usuario.includes(ref));
  if (env.APP_ENV === 'development' && noProjeto && host.endsWith('.supabase.co') || (env.APP_ENV === 'development' && noProjeto && host.endsWith('.pooler.supabase.com'))) {
    return null;
  }
  return recusa('host_nao_local', 'o banco nao e local nem o banco de desenvolvimento deste projeto (APP_ENV=development)');
}

/** Chaves de teste locais (nomes fixos de 19 §7 e 54 §5). Ausente ou invalida = recusa, sem valor. */
export function loadDemoKeys(env) {
  const faltando = [];
  const hmacRaw = env.DOCUMENT_HMAC_KEY ?? '';
  const versaoRaw = (env.DATA_ENC_KEY_ACTIVE_VERSION ?? '').trim().replace(/^[vV]/, '');
  const addressKey = env.ADDRESS_HASH_KEY ?? '';
  if (hmacRaw.trim() === '') faltando.push('DOCUMENT_HMAC_KEY');
  if (!/^[1-9][0-9]{0,2}$/.test(versaoRaw)) faltando.push('DATA_ENC_KEY_ACTIVE_VERSION');
  if (addressKey.length < ADDRESS_KEY_MIN) faltando.push('ADDRESS_HASH_KEY');
  const version = Number(versaoRaw);
  const encRaw = /^[1-9][0-9]{0,2}$/.test(versaoRaw) ? env[`DATA_ENC_KEY_V${version}`] ?? '' : '';
  if (encRaw.trim() === '') faltando.push(`DATA_ENC_KEY_V${versaoRaw || '?'}`);
  if (faltando.length > 0) {
    return { ok: false, refusal: recusa('configuracao_ausente', `variavel ausente ou invalida: ${faltando.join(', ')}`) };
  }
  const hmacKey = Buffer.from(hmacRaw.trim(), 'base64');
  const encKey = Buffer.from(encRaw.trim(), 'base64');
  if (hmacKey.length !== KEY_BYTES || encKey.length !== KEY_BYTES) {
    return { ok: false, refusal: recusa('configuracao_ausente', 'chave de teste com tamanho invalido') };
  }
  return { ok: true, keys: { hmacKey, encKey, version, addressKey } };
}

/** HMAC do documento (mesma forma do vault da API: doc1|TIPO|digitos). */
export function documentHmac(hmacKey, tipo, digits) {
  return createHmac('sha256', hmacKey).update(`${FORMAT_PREFIX}|${tipo}|${digits}`, 'utf8').digest('hex');
}

/** Cifra do documento: versao (1 byte) + nonce + tag + corpo; AAD por usuario, como na API. */
export function sealDocument(encKey, version, userId, digits) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encKey, nonce);
  cipher.setAAD(Buffer.from(`${FORMAT_PREFIX}|${userId}|document_enc`, 'utf8'));
  const corpo = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([version]), nonce, cipher.getAuthTag(), corpo]);
}

/** Normalizacao do endereco (68 §2.1): NFC, aparado, espacos colapsados, minusculas. */
export function normalizeAddress(text) {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** HMAC do endereco normalizado com ADDRESS_HASH_KEY (como em apps/api/src/geo/address-hash.ts). */
export function addressHash(addressKey, normalized) {
  return createHmac('sha256', addressKey).update(normalized, 'utf8').digest('hex');
}

/** SHA-256 hexadecimal de um texto fixo (valores de demo que so precisam ter 64 caracteres hex). */
export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
