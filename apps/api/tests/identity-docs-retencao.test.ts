// H-037 (Issue #50) | T-08 / CA-08 (107-DESENHO-H037 §13): busca estatica. Nenhum prazo de retencao para
// identity-docs no codigo nem nas migracoes da Issue; a retencao do bucket segue desligada (RN-08) e e' decisao da L1.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

function lerDir(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return lerDir(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

/** Codigo da Issue (sem comentarios de linha nem blocos de documentacao). */
function codigoSemComentarios(texto: string): string {
  return texto
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/** Migracoes e rollbacks da Issue #50 (prefixos fixos da fase 1). */
function migracoesDaIssue(): string[] {
  const dirs = [join(raiz, 'supabase', 'migrations'), join(raiz, 'supabase', 'rollbacks')];
  return dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((n) => /identity_(create|fix)_documents/.test(n))
      .map((n) => join(dir, n)),
  );
}

/** SQL sem comentarios `--`. */
function sqlSemComentarios(texto: string): string {
  return texto
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

const ARQUIVOS_CODIGO = [
  ...lerDir(join(raiz, 'apps', 'api', 'src', 'identity-docs')),
  ...lerDir(join(raiz, 'packages', 'domain', 'src', 'identity-docs')),
  join(raiz, 'packages', 'db', 'src', 'identity-docs.ts'),
  join(raiz, 'packages', 'db', 'src', 'identity-docs-storage.ts'),
];

describe('H-037 | T-08 / CA-08: nenhum prazo de retencao para identity-docs no codigo', () => {
  it('o codigo da Issue nao cita retencao, prazo ou expiracao de retencao', () => {
    const termos = /retention|retencao|retenção|prazo|expurgo_em|dias_de_guarda/i;
    for (const caminho of ARQUIVOS_CODIGO) {
      const linhas = codigoSemComentarios(readFileSync(caminho, 'utf8')).split('\n');
      for (const linha of linhas) {
        expect(termos.test(linha), `${caminho} tem prazo de retencao: ${linha.trim()}`).toBe(false);
      }
    }
  });

  it('nenhuma linha de codigo que cita identity-docs ou o bucket final tem literal de dias ou de meses', () => {
    const ligado = /identity-docs|IDOC_FINAL_BUCKET|identity_document/;
    const literalDias = /\b\d+\s*(dias?|days?|meses|months?)\b|\bretention_days\b/i;
    for (const caminho of ARQUIVOS_CODIGO) {
      for (const linha of codigoSemComentarios(readFileSync(caminho, 'utf8')).split('\n')) {
        if (!ligado.test(linha)) continue;
        expect(literalDias.test(linha), `${caminho}: ${linha.trim()}`).toBe(false);
      }
    }
  });

  it('as migracoes e os rollbacks da Issue #50 nao tocam a politica de retencao', () => {
    const arquivos = migracoesDaIssue();
    expect(arquivos.length).toBeGreaterThan(0);
    for (const caminho of arquivos) {
      const sql = sqlSemComentarios(readFileSync(caminho, 'utf8'));
      expect(/retention/i.test(sql), `${caminho} menciona retencao`).toBe(false);
    }
  });

  it('o modulo de retencao nao recebe regra especifica para identity-docs', () => {
    const dirRetencao = join(raiz, 'packages', 'domain', 'src', 'retention');
    for (const caminho of lerDir(dirRetencao)) {
      const linhas = codigoSemComentarios(readFileSync(caminho, 'utf8')).split('\n');
      for (const linha of linhas) {
        if (!/identity-docs/.test(linha)) continue;
        expect(/\d/.test(linha), `${caminho}: regra numerica para identity-docs: ${linha.trim()}`).toBe(false);
      }
    }
  });
});
