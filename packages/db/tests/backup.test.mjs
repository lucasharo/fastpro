// Testes OFFLINE do backup de dados (H-010; T-BK-02 a T-BK-12). Dados sinteticos, banco falso e gpg
// real (AES256). Nenhuma conexao externa. Pastas temporarias ficam fora do repositorio.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from '../scripts/lib/env.mjs';
import { runExport, statusReport, verifyBackup, StageError } from '../scripts/lib/export.mjs';
import { startGpg } from '../scripts/lib/gpg.mjs';
import {
  assertExpectedTarget,
  assertReaderPrivileges,
  retentionReport,
  sha256Stream,
  stamp,
} from '../scripts/lib/backup.mjs';
import { makeFakeDb } from './fixtures/fake-db.mjs';

const PASS = 'frase-de-teste-2026';
const URL_OK =
  'postgresql://app_backup_reader:<senha>@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
const REF = 'abcdefghijklmnopqrst';
const NOW = new Date('2026-11-10T12:00:00Z');
const DAY = 86400000;

let work;
let backupDir;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'fastpro-bk-'));
  backupDir = join(work, 'backups');
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function deps(db) {
  return { connect: db.connect, startGpg };
}

function runOnce(db, extra = {}) {
  return runExport({
    backupDir,
    repoRoot: REPO_ROOT,
    readerUrl: URL_OK,
    expectedRef: REF,
    passphrase: PASS,
    motivo: 'semanal',
    now: NOW,
    deps: deps(db),
    ...extra,
  });
}

function artifacts(dir = backupDir) {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function logLines() {
  const p = join(backupDir, 'backup-log.jsonl');
  return existsSync(p)
    ? readFileSync(p, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    : [];
}

describe('T-BK-02: exportacao nao cria arquivo versionavel', () => {
  it('o repositorio nao muda (git status antes e depois) e a pasta de saida fica fora dele', async () => {
    const before = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
    await runOnce(makeFakeDb());
    const after = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
    expect(after).toBe(before);
    expect(artifacts().length).toBeGreaterThan(0);
  }, 30000);
});

describe('T-BK-03: exportacao completa com verificacao', () => {
  it('promove o cifrado, grava manifesto com hashes e contagens, e verify passa', async () => {
    const db = makeFakeDb();
    const res = await runOnce(db);
    const names = artifacts();
    expect(names.some((n) => n.endsWith('.dados.gpg'))).toBe(true);
    expect(names.some((n) => n.endsWith('.manifest.json'))).toBe(true);
    const manifest = JSON.parse(readFileSync(res.manifesto, 'utf8'));
    expect(manifest.resultado).toBe('ok');
    expect(manifest.contagens).toEqual({ 'app.pedido': 2, 'ops.schema_migration': 1 });
    expect(manifest.sha256_cifrado).toBe(await sha256Stream(res.arquivo));
    expect(manifest.sha256_claro).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.schemas_incluidos).toEqual(['app', 'billing', 'audit', 'ops', 'private']);
    expect(manifest.schemas_excluidos).toContain('auth');
    expect(manifest.ultima_migracao).toBe('20261110180000');
    expect(manifest.chave).toBe('BACKUP_PASSPHRASE');
    // Leitura em uma unica transacao de leitura repetivel, com a string exata (conferida no banco falso).
    expect(db.state.statements[0]).toBe('begin isolation level repeatable read read only');
    expect(db.state.statements.at(-1)).toBe('commit');
    expect(logLines().at(-1)).toMatchObject({ resultado: 'ok', operacao: 'export' });
    expect(await verifyBackup({ manifestPath: res.manifesto, passphrase: PASS, startGpg })).toEqual(
      [],
    );
  });
});

describe('T-BK-04: byte alterado no cifrado e recusado', () => {
  it('a verificacao falha com um byte trocado', async () => {
    const res = await runOnce(makeFakeDb());
    const bytes = readFileSync(res.arquivo);
    bytes[Math.floor(bytes.length / 2)] ^= 0x01;
    writeFileSync(res.arquivo, bytes);
    const problems = await verifyBackup({
      manifestPath: res.manifesto,
      passphrase: PASS,
      startGpg,
    });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems).toContain('hash do cifrado diverge');
  });
});

describe('T-BK-05: falhas nao promovem nada e preservam a exportacao anterior', () => {
  it('(i) senha/autenticacao errada na conexao: falha na etapa conexao, nada gravado', async () => {
    const good = await runOnce(makeFakeDb());
    const shaBefore = await sha256Stream(good.arquivo);
    const db = makeFakeDb({ connectError: Object.assign(new Error('auth'), { code: '28P01' }) });
    await expect(runOnce(db)).rejects.toMatchObject({ stage: 'conexao', code: '28P01' });
    expect(artifacts().filter((n) => n.endsWith('.partial'))).toEqual([]);
    expect(await sha256Stream(good.arquivo)).toBe(shaBefore);
    expect(logLines().at(-1)).toMatchObject({ resultado: 'falha', etapa: 'conexao' });
  });

  it('(iii) interrupcao no meio da leitura: parcial removido, anterior intacta', async () => {
    const good = await runOnce(makeFakeDb());
    const shaBefore = await sha256Stream(good.arquivo);
    const db = makeFakeDb({ failOnDataOf: 'app.pedido' });
    await expect(runOnce(db, { now: new Date(NOW.getTime() + DAY) })).rejects.toBeInstanceOf(
      StageError,
    );
    expect(artifacts().filter((n) => n.endsWith('.partial'))).toEqual([]);
    expect(artifacts().filter((n) => n.endsWith('.dados.gpg'))).toHaveLength(1);
    expect(await sha256Stream(good.arquivo)).toBe(shaBefore);
    expect(logLines().at(-1)).toMatchObject({ resultado: 'falha', etapa: 'dados' });
  });

  it('(iv) divergencia de contagem forcada: falha na verificacao, nada promovido', async () => {
    const db = makeFakeDb({ countDelta: { 'app.pedido': 1 } });
    await expect(runOnce(db)).rejects.toMatchObject({ stage: 'verificacao' });
    expect(artifacts()).toEqual(['backup-log.jsonl']);
    expect(logLines().at(-1)).toMatchObject({ resultado: 'falha', etapa: 'verificacao' });
  });
});

describe('T-BK-06: frase-senha nunca fica em arquivo', () => {
  it('senha errada nao decifra; sem frase-senha a exportacao e recusada; a frase nao aparece em nenhum arquivo', async () => {
    const res = await runOnce(makeFakeDb());
    const problems = await verifyBackup({
      manifestPath: res.manifesto,
      passphrase: 'senha-errada-999999',
      startGpg,
    });
    expect(problems.length).toBeGreaterThan(0);
    await expect(runOnce(makeFakeDb(), { passphrase: '' })).rejects.toMatchObject({
      stage: 'pre-checagens',
    });
    for (const name of artifacts()) {
      const content = readFileSync(join(backupDir, name));
      expect(content.includes(PASS)).toBe(false);
    }
  });
});

describe('T-BK-07: destino dentro do repositorio ou por link e recusado antes de qualquer conexao', () => {
  it('pasta dentro do repositorio: recusa sem conectar e sem criar nada', async () => {
    const db = makeFakeDb();
    const inside = join(REPO_ROOT, 'packages', 'db', 'teste-backup-nao-criar');
    await expect(runOnce(db, { backupDir: inside })).rejects.toMatchObject({
      stage: 'pre-checagens',
    });
    expect(db.state.connects).toBe(0);
    expect(existsSync(inside)).toBe(false);
  });

  it('link (junction) para dentro do repositorio: recusado', async () => {
    const link = join(work, 'atalho');
    try {
      symlinkSync(join(REPO_ROOT, 'packages'), link, 'junction');
    } catch {
      return; // sem permissao para criar o link neste ambiente: caso nao verificavel aqui
    }
    const db = makeFakeDb();
    await expect(runOnce(db, { backupDir: join(link, 'db', 'x') })).rejects.toMatchObject({
      stage: 'pre-checagens',
    });
    expect(db.state.connects).toBe(0);
  });

  it('retencao: a 5a semanal nao apaga nada e o status lista o excedente', async () => {
    for (let i = 0; i < 5; i += 1) {
      await runOnce(makeFakeDb(), { now: new Date(NOW.getTime() + i * 1000) });
    }
    const before = artifacts().length;
    const rep = await statusReport({ backupDir, now: NOW, currentMigration: '20261110180000' });
    expect(rep.excedente).toHaveLength(1);
    expect(artifacts().length).toBe(before);
  });
});

describe('T-BK-08: papel sem BYPASSRLS e recusado (dump nao sai parcial)', () => {
  it('papel sem BYPASSRLS: recusa na etapa de conexao', async () => {
    const db = makeFakeDb({ bypassrls: false });
    await expect(runOnce(db)).rejects.toMatchObject({ stage: 'conexao', code: 'privilegio' });
    expect(artifacts().filter((n) => n.endsWith('.dados.gpg'))).toEqual([]);
  });

  it('o codigo do exportador nao contem a opcao de RLS do pg_dump', () => {
    const scripts = join(REPO_ROOT, 'packages', 'db', 'scripts');
    for (const file of ['backup.mjs', join('lib', 'export.mjs'), join('lib', 'gpg.mjs')]) {
      expect(readFileSync(join(scripts, file), 'utf8').includes('enable-row-security')).toBe(false);
    }
  });
});

describe('T-BK-09: toda tabela de dominio entra no backup', () => {
  it('tabela sem SELECT ao papel de leitura: recusa (nao exporta backup incompleto)', async () => {
    const db = makeFakeDb({ privileges: { 'app.pedido': { select: false } } });
    await expect(runOnce(db)).rejects.toMatchObject({ stage: 'conexao', code: 'privilegio' });
  });

  it('o manifesto lista exatamente as tabelas do catalogo', async () => {
    const res = await runOnce(makeFakeDb());
    const manifest = JSON.parse(readFileSync(res.manifesto, 'utf8'));
    expect(Object.keys(manifest.contagens).sort()).toEqual(['app.pedido', 'ops.schema_migration']);
  });
});

describe('T-BK-10: alvo diferente do esperado e recusado antes do dump', () => {
  it('BACKUP_EXPECTED_DB_REF diferente: recusa sem conectar', async () => {
    const db = makeFakeDb();
    await expect(runOnce(db, { expectedRef: 'zzzzzzzzzzzzzzzzzzzz' })).rejects.toMatchObject({
      stage: 'pre-checagens',
    });
    expect(db.state.connects).toBe(0);
    expect(() => assertExpectedTarget(URL_OK, REF)).not.toThrow();
  });
});

describe('T-BK-11: papel de leitura sem escrita', () => {
  it('privilegio de escrita detectado: recusa', () => {
    expect(() =>
      assertReaderPrivileges({
        role: 'app_backup_reader',
        bypassrls: true,
        tables: [{ select: true, write: true }],
      }),
    ).toThrow(/escrita/);
  });
});

describe('T-BK-12: status vencido e defasado', () => {
  it('exportacao de 8 dias com migracao defasada: VENCIDO e defasada', async () => {
    const res = await runOnce(makeFakeDb(), { now: new Date(NOW.getTime() - 8 * DAY) });
    const rep = await statusReport({ backupDir, now: NOW, currentMigration: '20261201000000' });
    expect(rep.vencido).toBe(true);
    expect(rep.paraMigracao).toBe(false);
    expect(rep.ultimaValida.idadeDias).toBe(8);
    expect(res.arquivo).toBeTruthy();
  });

  it('retentionReport sem exportacao valida fica vencido', () => {
    const r = retentionReport([], NOW, '20261110180000');
    expect(r.vencido).toBe(true);
    expect(r.paraMigracao).toBe(false);
  });

  it('stamp usa o formato AAAAMMDDTHHMMSSZ', () => {
    expect(stamp(NOW)).toBe('20261110T120000Z');
  });
});
