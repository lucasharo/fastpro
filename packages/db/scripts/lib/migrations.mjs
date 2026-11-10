// Logica pura (sem banco) do executor de migracoes: listar, validar nomes, checksum e plano.
// Formato do arquivo: supabase/migrations/AAAAMMDDHHMMSS_<modulo>_<verbo>_<objeto>.sql
// (19 §9). Desfazer (quando possivel): supabase/rollbacks/<mesmo nome>.down.sql, aplicado
// manualmente; nunca editar migracao ja aplicada (o checksum denuncia).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MIGRATION_NAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export function checksum(sql) {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/** Lista migracoes do diretorio, ordenadas por versao. Nome invalido ou versao repetida = erro. */
export function listMigrations(dir) {
  const items = [];
  const seen = new Set();
  for (const file of readdirSync(dir).sort()) {
    if (file === '.gitkeep') continue;
    const m = MIGRATION_NAME.exec(file);
    if (!m) throw new Error(`nome de migracao invalido: ${file}`);
    if (seen.has(m[1])) throw new Error(`versao de migracao repetida: ${m[1]}`);
    seen.add(m[1]);
    const sql = readFileSync(join(dir, file), 'utf8');
    items.push({ version: m[1], name: m[2], file, sql, checksum: checksum(sql) });
  }
  return items;
}

/**
 * Compara arquivos com o registro do banco.
 * - applied: [{version, checksum}] vindo da tabela de controle.
 * - pending: arquivos ainda nao aplicados, na ordem.
 * - problems: checksum alterado, migracao aplicada sem arquivo, ou pendente mais antiga que a
 *   ultima aplicada (ordem quebrada).
 */
export function plan(files, applied) {
  const byVersion = new Map(applied.map((a) => [a.version, a]));
  const fileVersions = new Set(files.map((f) => f.version));
  const problems = [];
  for (const a of applied) {
    if (!fileVersions.has(a.version)) problems.push(`aplicada sem arquivo: ${a.version}`);
  }
  const pending = [];
  let lastApplied = '';
  for (const a of applied) if (a.version > lastApplied) lastApplied = a.version;
  for (const f of files) {
    const a = byVersion.get(f.version);
    if (!a) {
      if (f.version < lastApplied) problems.push(`pendente fora de ordem: ${f.version}`);
      pending.push(f);
    } else if (a.checksum !== f.checksum) {
      problems.push(`checksum alterado apos aplicar: ${f.version}`);
    }
  }
  return { pending, problems };
}
