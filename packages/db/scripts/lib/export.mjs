// Exportacao e verificacao do backup de DADOS (H-010; desenho 28-DESENHO-H010.md §1.4 e §1.5).
// Le as tabelas de dominio com o papel de leitura, dentro de UMA transacao REPEATABLE READ READ ONLY,
// grava texto claro em fluxo direto para o gpg (AES256) e promove o arquivo so se a verificacao passar.
// Dependencias (conexao e gpg) sao injetadas: os testes usam dados sinteticos e o gpg real.
import { createHash, randomBytes } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import {
  DOMAIN_SCHEMAS,
  PlainCounter,
  artifactName,
  assertExpectedTarget,
  assertReaderPrivileges,
  buildManifest,
  compareCounts,
  failureRecord,
  footerLine,
  headerLine,
  manifestName,
  MANIFEST_SUFFIX,
  MIN_PASSPHRASE_LENGTH,
  retentionReport,
  rowLine,
  sha256Stream,
  stamp,
} from './backup.mjs';
import { assertOutsideRepo } from './safe-paths.mjs';

export const LOG_NAME = 'backup-log.jsonl';

const ROLE_Q =
  '/*fp:papel*/ select current_user as role, (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls';
const TABLES_Q = `/*fp:tabelas*/ select n.nspname as schema, c.relname as name,
    has_table_privilege(current_user, c.oid, 'SELECT') as sel,
    has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as wr
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = any($1) and c.relkind = 'r'
   and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass
                    and d.objid = c.oid and d.deptype = 'e')
 order by 1, 2`;
const MIG_Q = '/*fp:migracao*/ select max(version) as v from ops.schema_migration';
const VERSION_Q = "/*fp:versao*/ select current_setting('server_version') as v";

const ident = (s) => `"${s.replace(/"/g, '""')}"`;
const countQ = (schema, name) =>
  `/*fp:contagem*/ select count(*)::int as n from ${ident(schema)}.${ident(name)}`;
const dataQ = (schema, name) =>
  `/*fp:dados*/ select row_to_json(t)::text as j from ${ident(schema)}.${ident(name)} as t`;

/** Erro de uma etapa: so o nome da etapa e um codigo curto saem daqui (nada de mensagem do driver). */
export class StageError extends Error {
  constructor(stage, code, reason) {
    super(`falha na etapa ${stage} (${code})`);
    this.stage = stage;
    this.code = code;
    // Motivo proprio do exportador (recusas de pre-checagem). Nunca mensagem do driver.
    this.reason = reason;
  }
}

export function errorCode(err) {
  if (err instanceof StageError) return err.code;
  if (err && typeof err.code === 'string' && /^[A-Z0-9]{5}$|^[A-Z_]{3,20}$/.test(err.code))
    return err.code;
  return 'erro';
}

/**
 * Confere texto claro e cifrado. Retorna a lista de problemas (vazia = ok). Nunca imprime conteudo.
 * `expected` = { cipherSha, plainSha, counts } (o que o exportador declarou no manifesto).
 */
export async function verifyArtifact({ file, passphrase, startGpg, expected }) {
  const problems = [];
  if (expected.cipherSha !== undefined) {
    const cipher = await sha256Stream(file);
    if (cipher !== expected.cipherSha) return ['hash do cifrado diverge'];
  }
  const gpg = startGpg('decrypt', passphrase);
  gpg.stdin.on('error', () => {}); // gpg pode fechar a entrada cedo (frase-senha errada)
  const hash = createHash('sha256');
  const counter = new PlainCounter();
  gpg.stdout.on('data', (chunk) => hash.update(chunk));
  const lines = createInterface({ input: gpg.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => counter.feed(line));
  const source = createReadStream(file);
  source.on('error', () => {});
  source.pipe(gpg.stdin);
  const [code] = await Promise.all([gpg.exit, once(lines, 'close')]);
  if (code !== 0) problems.push('decifragem falhou (frase-senha ou integridade)');
  const { counts, problems: textProblems } = counter.finish();
  problems.push(...textProblems);
  if (expected.plainSha !== undefined && hash.digest('hex') !== expected.plainSha) {
    problems.push('hash do texto claro diverge');
  }
  if (expected.counts !== undefined) problems.push(...compareCounts(expected.counts, counts));
  return problems;
}

function removeIfExists(path) {
  if (path && existsSync(path)) unlinkSync(path);
}

function appendLog(dir, record) {
  appendFileSync(join(dir, LOG_NAME), `${JSON.stringify(record)}\n`);
}

/**
 * Executa a exportacao. Em qualquer falha: remove so o arquivo parcial desta execucao, registra a
 * falha (etapa e data) e relanca StageError. Exportacoes anteriores nunca sao tocadas.
 */
export async function runExport({
  backupDir,
  repoRoot,
  readerUrl,
  expectedRef,
  passphrase,
  motivo,
  now,
  deps,
}) {
  const execId = `BK-${stamp(now)}-${randomBytes(3).toString('hex')}`;
  let stage = 'pre-checagens';
  let dir = null;
  let partial = null;
  let manifestTmp = null;
  let client = null;
  let gpg = null;
  let writing = null;
  try {
    try {
      dir = assertOutsideRepo(backupDir, repoRoot, 'BACKUP_DIR');
      if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
        throw new Error('frase-senha ausente ou curta demais (recusado)');
      }
      assertExpectedTarget(readerUrl, expectedRef);
    } catch (err) {
      throw new StageError(stage, 'recusado', err.message);
    }
    mkdirSync(dir, { recursive: true });

    stage = 'conexao';
    client = await deps.connect(readerUrl);
    await client.query('begin isolation level repeatable read read only');
    const role = (await client.query(ROLE_Q)).rows[0];
    const tables = (await client.query(TABLES_Q, [DOMAIN_SCHEMAS])).rows;
    try {
      assertReaderPrivileges({
        role: role.role,
        bypassrls: role.bypassrls,
        tables: tables.map((t) => ({ select: t.sel, write: t.wr })),
      });
    } catch (err) {
      throw new StageError(stage, 'privilegio', err.message);
    }
    const versaoServidor = (await client.query(VERSION_Q)).rows[0].v;
    const ultimaMigracao = (await client.query(MIG_Q)).rows[0].v ?? null;

    stage = 'contagem';
    const contagens = {};
    for (const t of tables) {
      contagens[`${t.schema}.${t.name}`] = (await client.query(countQ(t.schema, t.name))).rows[0].n;
    }

    stage = 'dados';
    const artifact = join(dir, artifactName(now));
    partial = `${artifact}.partial`;
    gpg = deps.startGpg('encrypt', passphrase);
    writing = pipeline(gpg.stdout, createWriteStream(partial));
    writing.catch(() => {}); // erro tratado no await abaixo
    const plainHash = createHash('sha256');
    const write = async (text) => {
      plainHash.update(text);
      if (!gpg.stdin.write(text)) await once(gpg.stdin, 'drain');
    };
    for (const t of tables) {
      const name = `${t.schema}.${t.name}`;
      await write(headerLine(name));
      let n = 0;
      for (const row of (await client.query(dataQ(t.schema, t.name))).rows) {
        await write(rowLine(name, row.j));
        n += 1;
      }
      await write(footerLine(name, n));
    }
    gpg.stdin.end();
    const code = await gpg.exit;
    if (code !== 0) throw new StageError(stage, 'cifragem');
    await writing;

    stage = 'commit';
    await client.query('commit');

    stage = 'verificacao';
    const sha256Cifrado = await sha256Stream(partial);
    const sha256Claro = plainHash.digest('hex');
    const problems = await verifyArtifact({
      file: partial,
      passphrase,
      startGpg: deps.startGpg,
      expected: { cipherSha: sha256Cifrado, plainSha: sha256Claro, counts: contagens },
    });
    if (problems.length > 0) throw new StageError(stage, 'divergencia');

    stage = 'promocao';
    if (existsSync(artifact)) throw new StageError(stage, 'destino-existe');
    const manifest = buildManifest({
      execId,
      criadoEm: now,
      resultado: 'ok',
      motivo,
      arquivo: artifactName(now),
      sha256Cifrado,
      sha256Claro,
      ultimaMigracao,
      versaoServidor,
      contagens,
    });
    renameSync(partial, artifact);
    partial = null;
    const manifestPath = join(dir, manifestName(now));
    manifestTmp = `${manifestPath}.partial`;
    writeFileSync(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(manifestTmp, manifestPath);
    manifestTmp = null;
    appendLog(dir, {
      data: stamp(now),
      exec_id: execId,
      operacao: 'export',
      resultado: 'ok',
      motivo,
    });
    return { execId, arquivo: artifact, manifesto: manifestPath, contagens };
  } catch (err) {
    if (gpg) gpg.kill();
    // Espera o fluxo de escrita encerrar antes de apagar o parcial (no Windows o arquivo fica preso).
    if (writing) await writing.catch(() => {});
    removeIfExists(partial);
    removeIfExists(manifestTmp);
    const failStage = err instanceof StageError ? err.stage : stage;
    const reason = err instanceof StageError ? err.reason : undefined;
    if (dir) {
      try {
        appendLog(dir, failureRecord(now, execId, motivo, failStage));
      } catch {
        // sem pasta utilizavel nao ha onde registrar; a falha ja sai pelo chamador
      }
    }
    throw new StageError(failStage, errorCode(err), reason);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

/** Verificacao de uma exportacao pelo manifesto (BK-02, subcomando verify). Nao altera nada. */
export async function verifyBackup({ manifestPath, passphrase, startGpg }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const file = join(dirname(manifestPath), manifest.arquivo);
  return verifyArtifact({
    file,
    passphrase,
    startGpg,
    expected: {
      cipherSha: manifest.sha256_cifrado,
      plainSha: manifest.sha256_claro,
      counts: manifest.contagens,
    },
  });
}

/** Lista as exportacoes da pasta e aplica a situacao de retencao (sem apagar nada). */
export async function statusReport({ backupDir, now, currentMigration }) {
  const names = existsSync(backupDir) ? readdirSync(backupDir) : [];
  const manifests = [];
  for (const name of names.filter((n) => n.endsWith(MANIFEST_SUFFIX))) {
    let m;
    try {
      m = JSON.parse(readFileSync(join(backupDir, name), 'utf8'));
    } catch {
      manifests.push({ arquivo: name, resultado: 'ilegivel', valido: false });
      continue;
    }
    const file = join(backupDir, m.arquivo ?? '');
    let valido = false;
    if (m.arquivo && existsSync(file)) {
      valido = (await sha256Stream(file)) === m.sha256_cifrado;
    }
    manifests.push({ ...m, arquivo: m.arquivo ?? name, valido });
  }
  return retentionReport(manifests, now, currentMigration);
}
