// Backup manual de DADOS do banco de desenvolvimento (H-010). Uso a partir da raiz do repositorio:
//   corepack pnpm db:backup -- export [--motivo semanal|pre-migracao-destrutiva]
//   corepack pnpm db:backup -- verify <caminho-do-manifesto>
//   corepack pnpm db:backup -- status [--para-migracao]
// Variaveis (nomes; valores no ambiente ou .env.local): DATABASE_URL_BACKUP_READ, BACKUP_DIR,
// BACKUP_EXPECTED_DB_REF, BACKUP_PASSPHRASE_FILE (opcional). Nunca imprime valores.
import { basename } from 'node:path';
import { REPO_ROOT, MIGRATIONS_DIR, clientFor, loadEnvValue, safeError } from './lib/env.mjs';
import { listMigrations } from './lib/migrations.mjs';
import { MOTIVOS } from './lib/backup.mjs';
import { StageError, runExport, statusReport, verifyBackup } from './lib/export.mjs';
import { startGpg } from './lib/gpg.mjs';
import { getPassphrase } from './lib/passphrase.mjs';

function out(msg) {
  process.stdout.write(`${msg}\n`);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function connect(url) {
  const client = clientFor(url, 'fastpro-backup');
  await client.connect();
  return client;
}

function requireVar(name) {
  const value = loadEnvValue(name);
  if (!value) throw new StageError('configuracao', 'ausente', `${name} nao definida`);
  return value;
}

async function doExport(args) {
  const motivo = flag(args, '--motivo') ?? 'semanal';
  if (!MOTIVOS.includes(motivo)) {
    out(`motivo invalido (use ${MOTIVOS.join(' ou ')})`);
    return 2;
  }
  const backupDir = requireVar('BACKUP_DIR');
  const readerUrl = requireVar('DATABASE_URL_BACKUP_READ');
  const expectedRef = requireVar('BACKUP_EXPECTED_DB_REF');
  const passphrase = await getPassphrase({
    env: { BACKUP_PASSPHRASE_FILE: loadEnvValue('BACKUP_PASSPHRASE_FILE') },
    repoRoot: REPO_ROOT,
    confirm: true,
  });
  const res = await runExport({
    backupDir,
    repoRoot: REPO_ROOT,
    readerUrl,
    expectedRef,
    passphrase,
    motivo,
    now: new Date(),
    deps: { connect, startGpg },
  });
  const linhas = Object.values(res.contagens).reduce((a, b) => a + b, 0);
  out(
    `export ok: ${basename(res.arquivo)} (${Object.keys(res.contagens).length} tabelas, ${linhas} linhas)`,
  );
  out(`manifesto: ${basename(res.manifesto)}`);
  return 0;
}

async function doVerify(args) {
  const manifestPath = args.find((a) => !a.startsWith('--'));
  if (!manifestPath) {
    out('uso: verify <caminho-do-manifesto>');
    return 2;
  }
  const passphrase = await getPassphrase({
    env: { BACKUP_PASSPHRASE_FILE: loadEnvValue('BACKUP_PASSPHRASE_FILE') },
    repoRoot: REPO_ROOT,
    confirm: false,
  });
  const problems = await verifyBackup({ manifestPath, passphrase, startGpg });
  if (problems.length > 0) {
    out(`verify FALHOU: ${problems.join('; ')}`);
    return 1;
  }
  out('verify ok: hash do cifrado, decifragem e contagens por tabela conferem');
  return 0;
}

async function doStatus(args) {
  const backupDir = requireVar('BACKUP_DIR');
  const migrations = listMigrations(MIGRATIONS_DIR);
  const current = migrations.length > 0 ? migrations[migrations.length - 1].version : null;
  const rep = await statusReport({ backupDir, now: new Date(), currentMigration: current });
  if (rep.ultimaValida) {
    out(
      `Ultima exportacao valida: ${rep.ultimaValida.arquivo} ha ${rep.ultimaValida.idadeDias} dia(s)`,
    );
  } else {
    out('Nenhuma exportacao valida.');
  }
  out(
    rep.vencido
      ? 'Situacao: VENCIDO (7 dias ou mais, ou sem exportacao valida).'
      : 'Situacao: em dia.',
  );
  out(
    rep.paraMigracao
      ? 'Migracao: existe exportacao valida para a migracao atual.'
      : 'Migracao: defasada para migracao (nenhuma exportacao valida com a migracao atual).',
  );
  if (rep.excedente.length > 0) {
    out(`Excedente (nada foi apagado; remova manualmente se quiser): ${rep.excedente.join(', ')}`);
  }
  if (rep.invalidas.length > 0) out(`Invalidas ou ilegiveis: ${rep.invalidas.join(', ')}`);
  if (args.includes('--para-migracao') && !rep.paraMigracao) {
    out('Gate de migracao destrutiva: NAO liberado. Faca uma exportacao antes.');
    return 1;
  }
  return 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2).filter((a) => a !== '--');
  try {
    if (command === 'export') return await doExport(args);
    if (command === 'verify') return await doVerify(args);
    if (command === 'status') return await doStatus(args);
    out('uso: backup.mjs <export|verify|status>');
    return 2;
  } catch (err) {
    if (err instanceof StageError) {
      out(
        `${command} FALHOU na etapa ${err.stage} (${err.code})${err.reason ? `: ${err.reason}` : ''}`,
      );
    } else {
      out(`${command} FALHOU: ${safeError(err)}`);
    }
    return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = 1;
  },
);
