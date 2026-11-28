// H-097 (Issue 107) | CA-09: nao existe interruptor de envio de e-mail de login no painel admin nem nas
// configuracoes, e a chave de cota e so limite. Checagem estatica (sem banco, sem rede).
// Varre apps/admin/src, apps/api/src, packages/domain/src/admin, packages/db/src e .env.example.
// Decisao 27 (08/RN-7): nenhuma configuracao desliga o e-mail de login.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_LIMITS, QUOTA_CUTS } from '@fastpro/domain';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

function arquivos(dir: string, extensoes: readonly string[]): string[] {
  const saida: string[] = [];
  if (!existsSync(dir)) return saida;
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === 'dist' || nome === '.next') continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivos(caminho, extensoes));
    else if (extensoes.some((e) => nome.endsWith(e)) && !nome.includes('.test.')) saida.push(caminho);
  }
  return saida;
}

const AREAS = ['apps/admin/src', 'apps/api/src', 'packages/domain/src/admin', 'packages/db/src'].map((a) =>
  join(RAIZ, a),
);

function todosOsCodigos(): Array<{ caminho: string; texto: string }> {
  return AREAS.flatMap((dir) => arquivos(dir, ['.ts', '.tsx', '.mjs'])).map((caminho) => ({
    caminho: relative(RAIZ, caminho).replace(/\\/g, '/'),
    texto: readFileSync(caminho, 'utf8'),
  }));
}

/** E-mail perto de uma palavra de desligar ou ligar, nos dois sentidos, em comentarios ou codigo. */
const EMAIL_PERTO_DE_INTERRUPTOR =
  /\b(e-?mail|mail)\b[^\n]{0,30}\b(enable[sd]?|disable[sd]?|habilit\w*|desabilit\w*|desligar?|ligar?|interruptor|switch|toggle|kill[_ -]?switch|pausar?|pause)\b|\b(enable[sd]?|disable[sd]?|habilit\w*|desabilit\w*|desligar?|interruptor|switch|toggle|kill[_ -]?switch|pausar?|pause)\b[^\n]{0,30}\b(e-?mail|mail)\b/i;

/** Linha que declara ausencia ("nao ha", "sem", "nenhum") nao e mencao a interruptor. */
const DECLARA_AUSENCIA = /\b(n[aã]o|sem|nenhum[a]?)\b/i;

function afirmaInterruptor(linha: string): boolean {
  return EMAIL_PERTO_DE_INTERRUPTOR.test(linha) && !DECLARA_AUSENCIA.test(linha);
}

describe('CA-09: sem interruptor de e-mail de login (H-097, decisao 27)', () => {
  it('nenhum codigo do painel, da API, do dominio admin ou do banco tem interruptor de e-mail', () => {
    const achados = todosOsCodigos()
      .filter(({ texto }) => texto.split(/\r?\n/).some(afirmaInterruptor))
      .map(({ caminho }) => caminho);
    expect(achados).toEqual([]);
  });

  it('o ambiente de exemplo nao tem variavel que ligue ou desligue e-mail', () => {
    const env = readFileSync(join(RAIZ, '.env.example'), 'utf8');
    const nomes = env
      .split(/\r?\n/)
      .map((l) => l.split('=')[0]?.trim() ?? '')
      .filter((n) => /^[A-Z_]+$/.test(n));
    const interruptores = nomes.filter(
      (n) => /MAIL/.test(n) && /(ENABLE|DISABLE|LIGA|DESLIGA|SWITCH|KILL|PAUS|TOGGLE)/.test(n),
    );
    expect(interruptores).toEqual([]);
  });

  it('nenhuma chave de app_config menciona e-mail (a configuracao de limite nao liga nem desliga envio)', () => {
    const achados: string[] = [];
    for (const { caminho, texto } of todosOsCodigos()) {
      for (const linha of texto.split(/\r?\n/)) {
        if (/app_config/i.test(linha) && /mail/i.test(linha)) achados.push(`${caminho}: ${linha.trim()}`);
      }
    }
    expect(achados).toEqual([]);
  });

  it('a chave de cota e so limite: constantes congeladas, sem leitura de ambiente nem de configuracao', () => {
    expect(Object.isFrozen(PROVIDER_LIMITS)).toBe(true);
    expect(Object.isFrozen(QUOTA_CUTS)).toBe(true);
    expect(PROVIDER_LIMITS).toEqual({ dia: 100, mes: 3000 });
    const quota = readFileSync(join(RAIZ, 'packages/domain/src/notifications/quota.ts'), 'utf8');
    expect(quota).not.toMatch(/process\.env/);
    expect(quota).not.toMatch(/app_config/);
  });

  it('nenhuma rota ou tela grava a cota de e-mail (external_quota so muda pelo banco, no envio)', () => {
    const achados = todosOsCodigos()
      .filter(({ caminho }) => caminho.startsWith('apps/'))
      .filter(({ texto }) => /external_quota/.test(texto))
      .map(({ caminho }) => caminho);
    expect(achados).toEqual([]);
  });
});
