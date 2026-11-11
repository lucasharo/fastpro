// Logica pura do backup manual de DADOS (H-010; desenho 28-DESENHO-H010.md §1, ajustado pela decisao
// do Orquestrador: sem binarios do PostgreSQL; a estrutura vem das migracoes versionadas).
// Sem conexao e sem processo: nomes, formato do texto claro, verificacao, manifesto, retencao,
// identificacao do alvo (BK-09) e pre-checagem de privilegios (BK-01, D4).
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
  'information_schema',
  'pg_*',
];
export const WEEKLY_KEEP = 4; // D2: 4 semanais; as de migracao destrutiva nao entram no limite
export const MAX_AGE_DAYS = 7; // BK-07: "vencido" a partir de 7 dias
export const MOTIVOS = ['semanal', 'pre-migracao-destrutiva'];
export const ARTIFACT_PREFIX = 'fastpro-dev-';
export const ARTIFACT_SUFFIX = '.dados.gpg';
export const MANIFEST_SUFFIX = '.manifest.json';
export const PASSPHRASE_NAME = 'BACKUP_PASSPHRASE'; // so o nome vai ao manifesto, nunca o valor
export const MIN_PASSPHRASE_LENGTH = 12;
export const READER_ROLE = 'app_backup_reader';
export const FORMAT = 'fastpro-dados-jsonl-1';

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

/**
 * Pre-checagem do papel de leitura (D4, BK-01, T-BK-08, T-BK-09, T-BK-11). `info` vem de consultas
 * ao catalogo: papel atual, BYPASSRLS, e para cada tabela de dominio se tem SELECT e se tem escrita.
 * Lanca erro (sem detalhar nomes de tabela fora da lista) se algo estiver fora do desenho.
 */
export function assertReaderPrivileges(info) {
  if (info.role !== READER_ROLE)
    throw new Error('conexao nao e o papel de leitura do backup (recusado)');
  if (info.bypassrls !== true) {
    throw new Error('papel de leitura sem BYPASSRLS: o backup sairia incompleto (recusado)');
  }
  const semLeitura = info.tables.filter((t) => !t.select).length;
  if (semLeitura > 0) {
    throw new Error(`${semLeitura} tabela(s) de dominio sem SELECT ao papel de leitura (recusado)`);
  }
  const comEscrita = info.tables.filter((t) => t.write).length;
  if (comEscrita > 0) throw new Error('papel de leitura tem privilegio de escrita (recusado)');
  return true;
}

/** Linha de cabecalho de tabela no texto claro. */
export function headerLine(table) {
  return `${JSON.stringify({ tabela: table, inicio: 1 })}\n`;
}

/** Linha de uma tupla: a tupla ja vem como texto JSON (row_to_json::text). */
export function rowLine(table, rowJson) {
  return `{"tabela":${JSON.stringify(table)},"linha":${rowJson}}\n`;
}

/** Linha de fechamento com a contagem que o exportador declara para a tabela. */
export function footerLine(table, count) {
  return `${JSON.stringify({ tabela: table, fim: count })}\n`;
}

/**
 * Le o texto claro linha a linha e confere: cada tabela tem cabecalho, as linhas batem com o "fim"
 * declarado, e nao ha tabela sem fechamento. Retorna as contagens lidas e os problemas.
 */
export class PlainCounter {
  constructor() {
    this.counts = new Map();
    this.declared = new Map();
    this.open = null;
    this.problems = [];
  }

  feed(line) {
    if (line === '') return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      this.problems.push('linha invalida no texto claro');
      return;
    }
    if (obj.inicio === 1) {
      if (this.open !== null) this.problems.push(`tabela sem fechamento: ${this.open}`);
      this.open = obj.tabela;
      this.counts.set(obj.tabela, 0);
    } else if (obj.fim !== undefined) {
      if (this.open !== obj.tabela) this.problems.push(`fechamento fora de ordem: ${obj.tabela}`);
      this.declared.set(obj.tabela, obj.fim);
      this.open = null;
    } else if (obj.linha !== undefined) {
      if (this.open !== obj.tabela) this.problems.push(`linha fora de bloco: ${obj.tabela}`);
      this.counts.set(obj.tabela, (this.counts.get(obj.tabela) ?? 0) + 1);
    } else {
      this.problems.push('linha desconhecida no texto claro');
    }
  }

  finish() {
    if (this.open !== null) this.problems.push(`tabela sem fechamento: ${this.open}`);
    for (const [table, n] of this.counts) {
      if (this.declared.get(table) !== n)
        this.problems.push(`contagem interna divergente: ${table}`);
    }
    return { counts: this.counts, problems: this.problems };
  }
}

/** Compara contagens esperadas (catalogo/manifesto) com as lidas. Retorna divergencias (sem valores). */
export function compareCounts(expected, actual) {
  const problems = [];
  for (const [table, n] of Object.entries(expected)) {
    if (!actual.has(table)) problems.push(`tabela ausente: ${table}`);
    else if (actual.get(table) !== n) problems.push(`contagem divergente: ${table}`);
  }
  for (const table of actual.keys()) {
    if (!(table in expected)) problems.push(`tabela extra: ${table}`);
  }
  return problems;
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

/**
 * Situacao das exportacoes (BK-07, BK-08, D2). Cada manifesto recebe `valido` (arquivo existe e o
 * hash do cifrado confere; calculado pelo chamador). Nunca apaga: so informa o excedente.
 */
export function retentionReport(manifests, now, currentMigration) {
  const valid = manifests
    .filter((m) => m.resultado === 'ok' && m.valido === true)
    .map((m) => ({ ...m, criadoEm: parseStamp(m.criado_em) }))
    .filter((m) => m.criadoEm)
    .sort((a, b) => b.criadoEm - a.criadoEm);
  const last = valid[0] ?? null;
  const weekly = valid.filter((m) => m.motivo === 'semanal');
  return {
    ultimaValida: last
      ? {
          arquivo: last.arquivo,
          criadoEm: last.criadoEm,
          idadeDias: Math.floor((now - last.criadoEm) / 86400000),
        }
      : null,
    vencido: last === null || now - last.criadoEm >= MAX_AGE_DAYS * 86400000,
    excedente: weekly.slice(WEEKLY_KEEP).map((m) => m.arquivo),
    paraMigracao: valid.some((m) => m.ultima_migracao === currentMigration),
    invalidas: manifests
      .filter((m) => !(m.resultado === 'ok' && m.valido === true))
      .map((m) => m.arquivo),
  };
}

export function buildManifest(data) {
  return {
    schema_manifesto: 1,
    formato: FORMAT,
    exec_id: data.execId,
    criado_em: stamp(data.criadoEm),
    resultado: data.resultado,
    motivo: data.motivo,
    arquivo: data.arquivo,
    sha256_cifrado: data.sha256Cifrado,
    sha256_claro: data.sha256Claro,
    chave: PASSPHRASE_NAME,
    cifra: 'gpg --symmetric --cipher-algo AES256',
    escopo: 'dados (estrutura versionada nas migracoes)',
    schemas_incluidos: DOMAIN_SCHEMAS,
    schemas_excluidos: EXCLUDED_SCHEMAS,
    ultima_migracao: data.ultimaMigracao,
    versao_servidor: data.versaoServidor,
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
