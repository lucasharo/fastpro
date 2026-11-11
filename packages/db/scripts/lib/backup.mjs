// Logica pura do backup manual (H-010; desenho 28-DESENHO-H010.md §1). Sem conexao e sem processo:
// nomes, manifesto, retencao, identificacao do alvo (BK-09), leitura do texto do restore e comparacao.
// Nunca guarda nem imprime valor de variavel de ambiente, senha, frase-senha ou host.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export const DOMAIN_SCHEMAS = ['app', 'billing', 'audit', 'ops', 'private'];
export const EXCLUDED_SCHEMAS = [
  'auth',
  'storage',
  'vault',
  'realtime',
  'graphql',
  'graphql_public',
  'pgsodium',
  'cron',
  'net',
  'supabase_*',
  'pg_*',
  'information_schema',
];
export const EXTENSIONS = ['postgis', 'pg_trgm', 'unaccent', 'citext', 'btree_gist'];
export const WEEKLY_KEEP = 4; // D2: 4 semanais; as de migracao destrutiva nao entram no limite
export const MAX_AGE_DAYS = 7; // BK-07: "vencido" a partir de 7 dias
export const MOTIVOS = ['semanal', 'pre-migracao-destrutiva'];
export const ARTIFACT_PREFIX = 'fastpro-dev-';
export const ARTIFACT_SUFFIX = '.dump.gpg';
export const MANIFEST_SUFFIX = '.manifest.json';
export const PASSPHRASE_NAME = 'BACKUP_PASSPHRASE'; // so o nome vai ao manifesto, nunca o valor
export const MIN_PASSPHRASE_LENGTH = 12;

const REF = /^[a-z0-9]{20}$/;

/** Carimbo UTC compacto: AAAAMMDDTHHMMSSZ. */
export function stamp(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Converte o carimbo de volta para Date (null se o formato nao bater). */
export function parseStamp(text) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text ?? '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

export function artifactName(date) {
  return `${ARTIFACT_PREFIX}${stamp(date)}${ARTIFACT_SUFFIX}`;
}

export function manifestName(date) {
  return `${ARTIFACT_PREFIX}${stamp(date)}${MANIFEST_SUFFIX}`;
}

/**
 * Identificador do projeto de desenvolvimento (BK-09): vem do host direto (db.<ref>.supabase.co) ou
 * do usuario do pooler (papel.<ref>). Retorna null se nao for possivel identificar.
 */
export function projectRefOf(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return null;
  }
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1];
  const fromUser = /\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username))?.[1];
  return fromHost ?? fromUser ?? null;
}

/** Recusa antes de qualquer conexao se o alvo nao for exatamente o projeto esperado (BK-09, T-BK-10). */
export function assertExpectedTarget(connectionString, expectedRef) {
  if (!expectedRef || !REF.test(expectedRef)) {
    throw new Error('BACKUP_EXPECTED_DB_REF ausente ou invalida (recusado)');
  }
  const ref = projectRefOf(connectionString);
  if (ref === null) throw new Error('nao foi possivel identificar o projeto do destino (recusado)');
  if (ref !== expectedRef) throw new Error('destino diferente do projeto esperado (recusado)');
  return true;
}

/** Credenciais e parametros do pg_dump/pg_restore a partir da URL (nunca na linha de comando). */
export function pgEnvFromUrl(connectionString) {
  const url = new URL(connectionString);
  // Nome da variavel montado em partes: o valor vem da URL em tempo de execucao, nunca do codigo.
  const passKey = ['PG', 'PASSWORD'].join('');
  const env = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    PGCONNECT_TIMEOUT: '15',
  };
  env[passKey] = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

export function sha256Stream(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(path);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Versao do pg_dump ("pg_dump (PostgreSQL) 17.11") em numero comparavel (170011). */
export function versionNum(text) {
  const m = /(\d+)(?:\.(\d+))?/.exec(text ?? '');
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2] ?? 0);
  return major >= 10 ? major * 10000 + minor : major * 10000 + minor * 100;
}

/**
 * Le as linhas do pg_restore --list e devolve o conjunto "esquema.tabela" com TABLE DATA.
 * Ex.: "1234; 0 16384 TABLE DATA app pedido owner".
 */
export function tablesFromRestoreList(text) {
  const found = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /\sTABLE DATA (\S+) (\S+) /.exec(line);
    if (m) found.add(`${m[1]}.${m[2]}`);
  }
  return found;
}

/**
 * Conta linhas de dados em cada bloco "COPY esquema.tabela (...) FROM stdin;" ate a linha "\.".
 * Recebe linhas uma a uma (streaming), para nao manter o dump inteiro em memoria.
 */
export class CopyCounter {
  constructor() {
    this.counts = new Map();
    this.current = null;
  }

  feed(line) {
    if (this.current === null) {
      const m = /^COPY (\S+?)(?: \(|\s)[^\n]*FROM stdin;$/.exec(line);
      if (m) {
        this.current = unquote(m[1]);
        this.counts.set(this.current, 0);
      }
      return;
    }
    if (line === '\\.') {
      this.current = null;
      return;
    }
    this.counts.set(this.current, this.counts.get(this.current) + 1);
  }
}

function unquote(qualified) {
  return qualified.replace(/"/g, '');
}

/** Compara contagens esperadas (manifesto/snapshot) com as lidas do dump. Retorna divergencias. */
export function compareCounts(expected, actual) {
  const problems = [];
  for (const [table, n] of Object.entries(expected)) {
    if (!actual.has(table)) problems.push(`tabela ausente no dump: ${table}`);
    else if (actual.get(table) !== n) problems.push(`contagem divergente: ${table}`);
  }
  for (const table of actual.keys()) {
    if (!(table in expected)) problems.push(`tabela extra no dump: ${table}`);
  }
  return problems;
}

/**
 * Situacao das exportacoes (BK-07, BK-08, D2). `manifests` = objetos lidos dos manifestos;
 * `isValid(m)` confere se o arquivo existe e o hash do cifrado confere (feito pelo chamador).
 * Nunca decide apagar: so informa o excedente.
 */
export function retentionReport(manifests, isValid, now, currentMigration) {
  const valid = manifests
    .filter((m) => m.resultado === 'ok' && isValid(m))
    .map((m) => ({ ...m, criadoEm: parseStamp(m.criado_em) }))
    .filter((m) => m.criadoEm)
    .sort((a, b) => b.criadoEm - a.criadoEm);
  const last = valid[0] ?? null;
  const ageDays = last ? Math.floor((now - last.criadoEm) / 86400000) : null;
  const weekly = valid.filter((m) => m.motivo === 'semanal');
  return {
    ultimaValida: last
      ? { arquivo: last.arquivo, criadoEm: last.criadoEm, idadeDias: ageDays }
      : null,
    vencido: last === null || now - last.criadoEm >= MAX_AGE_DAYS * 86400000,
    excedente: weekly.slice(WEEKLY_KEEP).map((m) => m.arquivo),
    paraMigracao: valid.some((m) => m.ultima_migracao === currentMigration),
    invalidas: manifests.filter((m) => m.resultado !== 'ok' || !isValid(m)).map((m) => m.arquivo),
  };
}

export function buildManifest(data) {
  return {
    schema_manifesto: 1,
    exec_id: data.execId,
    criado_em: stamp(data.criadoEm),
    resultado: data.resultado,
    etapa_falha: data.etapaFalha ?? null,
    motivo: data.motivo,
    arquivo: data.arquivo,
    sha256_cifrado: data.sha256Cifrado,
    sha256_claro: data.sha256Claro,
    chave: PASSPHRASE_NAME,
    cifra: 'gpg --symmetric --cipher-algo AES256',
    schemas_incluidos: [...DOMAIN_SCHEMAS, 'extensions'],
    schemas_excluidos: EXCLUDED_SCHEMAS,
    extensoes: EXTENSIONS,
    ultima_migracao: data.ultimaMigracao,
    versao_servidor: data.versaoServidor,
    versao_pg_dump: data.versaoPgDump,
    contagens: data.contagens,
  };
}

export function failureRecord(now, execId, motivo, etapa) {
  return {
    data: stamp(now),
    exec_id: execId,
    operacao: 'export',
    motivo,
    resultado: 'falha',
    etapa,
  };
}

/** Linha do registro de keep-alive: so data, hora, resultado e etapa (KA-02). */
export function keepAliveLine(now, result) {
  return result.ok ? `${stamp(now)} ok` : `${stamp(now)} falha etapa=${result.etapa}`;
}

export function hashOf(text) {
  return createHash('sha256').update(text).digest('hex');
}
