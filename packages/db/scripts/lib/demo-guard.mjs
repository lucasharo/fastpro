// H-120 (Issue 129) | Trava de ambiente da carga de demonstracao e chaves de teste locais.
// Funcoes puras (sem banco, sem rede, sem imprimir valores). Ver 85-DESENHO-H120 §1 e decisao 58
// (11-DECISOES.md), que substitui a trava so-local para o banco de desenvolvimento do proprio projeto.
// Aceita somente:
//  - banco local (127.0.0.1, localhost ou ::1) com FASTPRO_DEMO_ALLOW exatamente "local"; ou
//  - banco de desenvolvimento do projeto: APP_ENV exatamente "development" e o ref de
//    NEXT_PUBLIC_SUPABASE_URL igual ao ref do banco, por padrao exato: host db.<ref>.supabase.co, ou
//    usuario postgres.<ref> em *.pooler.supabase.com. Ref so no usuario ou so no host nao basta
//    para outros padroes; nunca por substring.
//  - Parametros de URL: somente sslmode. host, hostaddr, options, service, dbname e os demais sao recusados.
// Recusa: { codigo, mensagem }. Nenhuma mensagem contem valor de conexao ou de chave.
import { Buffer } from 'node:buffer';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

export const DEMO_ALLOW_VALUE = 'local';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
// Unico parametro de URL permitido (decisao 58). Qualquer outro e recusado.
const PARAMETROS_PERMITIDOS = new Set(['sslmode']);
// Padroes exatos do Supabase (ref de 20 caracteres minusculos). Sem substring.
const HOST_DIRETO_RE = /^db\.([a-z0-9]{20})\.supabase\.co$/;
const HOST_POOLER_RE = /^[a-z0-9-]+\.pooler\.supabase\.com$/;
const USUARIO_POOLER_RE = /^postgres\.([a-z0-9]{20})$/;
const URL_PUBLICA_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;
const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const ADDRESS_KEY_MIN = 32;
const FORMAT_PREFIX = 'doc1';

function recusa(codigo, mensagem) {
  return { codigo, mensagem };
}

/** Host de um objeto URL, sem colchetes e em minusculas. */
function hostDe(url) {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/** Host de uma URL de conexao, sem colchetes. null se a URL nao puder ser lida. */
export function hostOfDbUrl(dbUrl) {
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    return null;
  }
  return hostDe(url);
}

/** Ref do projeto Supabase (20 caracteres minusculos) a partir da URL publica do .env.local. */
export function projectRefOf(supabaseUrl) {
  const m = typeof supabaseUrl === 'string' ? URL_PUBLICA_RE.exec(supabaseUrl) : null;
  return m ? m[1] : null;
}

/**
 * true se host e usuario apontam para o banco do projeto de ref. Padrao exato, sem substring:
 * db.<ref>.supabase.co (ref no host); ou usuario postgres.<ref> em *.pooler.supabase.com (ref no usuario).
 * Qualquer outro host de *.supabase.co e recusado, e o ref de outro padrao nao vale.
 */
function apontaParaProjeto(host, usuario, ref) {
  if (ref === null) return false;
  const direto = HOST_DIRETO_RE.exec(host);
  if (direto !== null) return direto[1] === ref;
  if (HOST_POOLER_RE.test(host)) {
    const pool = USUARIO_POOLER_RE.exec(usuario);
    return pool !== null && pool[1] === ref;
  }
  return false;
}

/**
 * Trava de ambiente. Devolve null quando a carga pode prosseguir.
 * Aceita (decisao 58):
 *  - banco local com FASTPRO_DEMO_ALLOW="local"; ou
 *  - banco de DESENVOLVIMENTO do proprio projeto: APP_ENV="development" (exato) e o ref do banco
 *    (padrao exato de host ou de usuario, ver apontaParaProjeto) igual ao ref de NEXT_PUBLIC_SUPABASE_URL.
 * Qualquer outro host, ambiente ou parametro (que nao seja sslmode) e recusado.
 */
export function demoGuardRefusal(env, dbUrl) {
  if (typeof dbUrl !== 'string' || dbUrl === '') {
    return recusa('banco_nao_configurado', 'DATABASE_URL_MIGRATIONS ausente (ambiente ou .env.local)');
  }
  let url;
  let usuario;
  try {
    url = new URL(dbUrl);
    usuario = decodeURIComponent(url.username);
  } catch {
    return recusa('banco_invalido', 'DATABASE_URL_MIGRATIONS nao pode ser lida');
  }
  const host = hostDe(url);
  const chaves = [...url.searchParams.keys()];
  if (chaves.includes('host') || chaves.includes('hostaddr')) {
    return recusa('host_nao_local', 'a URL traz parametro de host; use somente host local ou o banco de desenvolvimento');
  }
  if (chaves.some((chave) => !PARAMETROS_PERMITIDOS.has(chave))) {
    return recusa('parametro_nao_permitido', 'a URL traz parametro fora da lista permitida (somente sslmode)');
  }
  if (LOCAL_HOSTS.has(host)) {
    if (env.FASTPRO_DEMO_ALLOW !== DEMO_ALLOW_VALUE) {
      return recusa('ambiente_nao_permitido', 'banco local exige FASTPRO_DEMO_ALLOW exatamente "local"');
    }
    return null;
  }
  const ref = projectRefOf(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!apontaParaProjeto(host, usuario, ref)) {
    return recusa('host_nao_local', 'o banco nao e local nem o banco de desenvolvimento deste projeto (ref de NEXT_PUBLIC_SUPABASE_URL ausente ou diferente)');
  }
  if (env.APP_ENV !== 'development') {
    return recusa('ambiente_nao_permitido', 'banco de desenvolvimento exige APP_ENV exatamente "development"');
  }
  return null;
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
