// H-109 (Issue #118) | CA-H109-11 em teste estatico (docs/factory/82-DESENHO-H109.md §7): nenhum prazo literal
// de RC-01 a RC-11 nos fontes TypeScript de retencao (packages/domain/src/retention e packages/db/src/retention-*.ts).
// Prazos sao dado (registro de politica, com aprovacao), nunca constante no codigo. Sem banco e sem rede.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const DOMINIO = new URL('../../domain/src/retention/', import.meta.url);
const BANCO = new URL('../src/', import.meta.url);

/** Padroes de prazo literal: numero com unidade de tempo, intervalo literal e make_interval com numero fixo. */
const UNIDADE = /\b\d+\s*(dias?|meses|mes|anos?|semanas?|days?|months?|years?|weeks?)\b/i;
const INTERVALO = /interval\s*'\s*\d+/i;
const MAKE_INTERVAL = /make_interval\s*\(\s*(days|months|years|weeks)\s*=>\s*\d/i;
// Classe mapeada a numero (ex.: 'RC-01': 30). Mapeamento de classe a prazo e o caso que a regra quer barrar.
const CODIGO_RC = /RC-(0[1-9]|1[01])['"]?\s*[:=]\s*\d/;

/** Fontes TypeScript de retencao, com o caminho para mensagens de falha. */
function fontes() {
  const dominio = readdirSync(DOMINIO)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [`packages/domain/src/retention/${f}`, readFileSync(new URL(f, DOMINIO), 'utf8')]);
  const banco = readdirSync(BANCO)
    .filter((f) => /^retention-.*\.ts$/.test(f))
    .map((f) => [`packages/db/src/${f}`, readFileSync(new URL(f, BANCO), 'utf8')]);
  return [...dominio, ...banco];
}

/** Linhas suspeitas de um fonte: prazo literal com unidade, intervalo literal, ou classe RC-xx mapeada a numero. */
function suspeitas(texto) {
  return texto
    .split(/\r?\n/)
    .map((linha, i) => ({ linha, n: i + 1 }))
    .filter(({ linha }) => UNIDADE.test(linha) || INTERVALO.test(linha) || MAKE_INTERVAL.test(linha)
      || CODIGO_RC.test(linha));
}

describe('CA-H109-11 fontes de retencao sem prazo literal (teste estatico)', () => {
  it('varre os fontes esperados (nao passa por vacuo)', () => {
    const nomes = fontes().map(([nome]) => nome);
    expect(nomes).toContain('packages/domain/src/retention/policy.ts');
    expect(nomes).toContain('packages/domain/src/retention/purge.ts');
    expect(nomes).toContain('packages/db/src/retention-store.ts');
    expect(nomes).toContain('packages/db/src/retention-jobs.ts');
    expect(nomes.length).toBeGreaterThanOrEqual(6);
  });

  it('nenhum prazo literal de RC-01 a RC-11 em nenhum fonte TypeScript de retencao', () => {
    const achados = fontes().flatMap(([nome, texto]) =>
      suspeitas(texto).map(({ linha, n }) => `${nome}:${n}: ${linha.trim()}`));
    expect(achados).toEqual([]);
  });

  it('controle negativo: a busca reconhece um prazo literal e um intervalo literal', () => {
    expect(suspeitas("const prazo = 30 dias; // RC-03").length).toBe(1);
    expect(suspeitas("select now() - interval '5 years'").length).toBe(1);
    expect(suspeitas("make_interval(days => 30)").length).toBe(1);
    expect(suspeitas("const prazos = { 'RC-01': 30 };").length).toBe(1);
    expect(suspeitas('const lote = 100; // RC-03 classe').length).toBe(0);
  });
});
