// Testes estaticos do runbook de incidente e reconciliacao (H-114, Issue #123; desenho 165 §5).
// Offline: le docs/factory/149-RUNBOOK-INCIDENTE-RECONCILIACAO.md e confere estrutura e termos proibidos.
// CA-01: nenhum termo de copia ou exportacao de dados no runbook (decisao do dono: nao mencionar).
// CA-02: nenhuma menção a recurso de mapa no runbook.
// CA-20: secoes 0 a 11 em ordem e os oito campos do molde em cada procedimento.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const RUNBOOK = new URL(
  '../../../docs/factory/149-RUNBOOK-INCIDENTE-RECONCILIACAO.md',
  import.meta.url,
);
const texto = readFileSync(RUNBOOK, 'utf8');

// Termos proibidos no runbook (copia, exportacao, recurso de mapa). Montados em partes so para
// nao aparecerem literais em outros arquivos do repositorio.
const PROIBIDOS = [
  'back' + 'up',
  'restaur',
  'expor' + 'ta',
  'export',
  'pg_' + 'dump',
  'restore' + '_db',
  'dump' + '_s3',
  'app_' + 'backup_reader',
  'db:' + 'backup',
  'map' + 'box',
  'dum' + 'p',
];

// Os oito campos do molde (desenho 165 §3), cada um como rotulo em negrito.
const CAMPOS = [
  '**Gatilho',
  '**Quem',
  '**Pré-condições',
  '**Passos',
  '**Verificação',
  '**Auditoria',
  '**Exercício sintético',
  '**Registro de evidência',
];

/** Divide o texto em secoes de nivel 2 ("## N. Titulo") e devolve [{ num, titulo, corpo }]. */
function secoes(fonte) {
  const partes = fonte.split(/^(?=## \d+\. )/m).filter((p) => /^## \d+\. /.test(p));
  return partes.map((p) => {
    const cabeca = p.split('\n', 1)[0];
    const m = /^## (\d+)\. (.*)$/.exec(cabeca);
    return { num: Number(m[1]), titulo: m[2], corpo: p };
  });
}

describe('CA-01: runbook sem termos de copia ou exportacao de dados', () => {
  it('nenhum termo proibido aparece em nenhuma secao (inclusive em Exclusoes)', () => {
    const minusculo = texto.toLowerCase();
    const achados = PROIBIDOS.filter((t) => minusculo.includes(t.toLowerCase()));
    expect(achados).toEqual([]);
  });
});

describe('CA-02: nenhuma mencao a recurso de mapa', () => {
  it('o termo de provedor de mapa nao aparece no runbook', () => {
    expect(texto.toLowerCase()).not.toContain('map' + 'box');
  });
});

describe('CA-20: estrutura do runbook', () => {
  const lista = secoes(texto);

  it('secoes 0 a 11 presentes, na ordem e sem repeticao', () => {
    expect(lista.map((s) => s.num)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('secao 0 tem escopo e exclusoes; secao 11 tem pendencias juridicas', () => {
    expect(lista[0].corpo).toContain('**Escopo.**');
    expect(lista[0].corpo).toContain('**Exclusões.**');
    expect(lista[11].corpo).toContain('[PENDENTE JURIDICO]');
  });

  it('D-04 e D-05 completos: cada um tem os oito campos do molde', () => {
    for (const num of [2, 3]) {
      const secao = lista.find((s) => s.num === num);
      for (const campo of CAMPOS) {
        expect(secao.corpo, `secao ${num} sem ${campo}`).toContain(campo);
      }
    }
  });

  it('procedimentos das secoes 2 a 9 (incluindo D-06a/b/c) trazem os oito campos', () => {
    for (const s of lista.filter((x) => x.num >= 2 && x.num <= 9)) {
      const subs = s.corpo.split(/^(?=### )/m).filter((p) => p.startsWith('### '));
      const blocos = subs.length > 0 ? subs : [s.corpo];
      for (const bloco of blocos) {
        for (const campo of CAMPOS) {
          expect(bloco, `secao ${s.num} (${bloco.split('\n', 1)[0]}) sem ${campo}`).toContain(
            campo,
          );
        }
      }
    }
  });

  it('marcador de teste [TESTE-H114] e etiquetas de rascunho declarados na regra geral', () => {
    const regras = lista.find((s) => s.num === 1).corpo;
    expect(regras).toContain('[TESTE-H114]');
    expect(texto).toContain('[PENDENTE JURIDICO]');
    expect(texto).toContain('[PROPOSTA]');
  });

  it('D-09 declara minutas como PENDENTE JURIDICO e nada enviado em DEV', () => {
    const d09 = lista.find((s) => s.num === 6).corpo;
    expect(d09).toContain('[PENDENTE JURIDICO]');
    expect(d09).toContain('Nada é enviado em DEV');
  });
});
