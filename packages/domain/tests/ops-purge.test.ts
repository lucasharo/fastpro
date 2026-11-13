// H-110 (Issue #119) | Orquestracao dos expurgos operacionais (docs/factory/105-DESENHO-H110.md §7, CA-H110-01, 11, 15, 16).
// Sem banco e sem Storage: executores falsos registram a ordem e devolvem resultados programados.
import { describe, expect, it } from 'vitest';
import {
  BLOCOS_OPS_PURGE,
  executaOpsPurge,
  type BlocoOpsPurge,
  type ExecutorBlocoOpsPurge,
  type ResultadoLoteOpsPurge,
} from '../src/ops-purge/index.js';

const ok = (removidos = 0, retidos = 0): ResultadoLoteOpsPurge => ({ estado: 'ok', removidos, retidos, falhos: 0 });

function relogio(passo = 0) {
  let t = 0;
  return {
    agora: () => {
      const atual = t;
      t += passo;
      return atual;
    },
  };
}

function executor(bloco: BlocoOpsPurge, lotes: ResultadoLoteOpsPurge[], chamadas: string[]): ExecutorBlocoOpsPurge {
  let i = 0;
  return {
    bloco,
    async lote() {
      chamadas.push(bloco);
      const r = lotes[Math.min(i, lotes.length - 1)];
      i += 1;
      return r;
    },
  };
}

describe('executaOpsPurge', () => {
  it('executa os blocos na ordem E1 a E9', async () => {
    const chamadas: string[] = [];
    const executores = BLOCOS_OPS_PURGE.map((b) => executor(b, [ok(0)], chamadas));
    await executaOpsPurge({ executores, ...relogio() });
    expect(chamadas).toEqual([...BLOCOS_OPS_PURGE]);
  });

  it('isola a falha: o bloco vira falha e os demais seguem (caso de borda 9)', async () => {
    const chamadas: string[] = [];
    const executores: ExecutorBlocoOpsPurge[] = BLOCOS_OPS_PURGE.map((b) => {
      if (b === 'e2') {
        return { bloco: b, async lote() { chamadas.push(b); throw new Error('storage_falha'); } };
      }
      return executor(b, [ok(1)], chamadas);
    });
    const r = await executaOpsPurge({ executores, maxLotes: 1, ...relogio() });
    expect(r.estados.e2).toBe('falha');
    expect(r.contagens.e2_falhos).toBe(1);
    expect(r.estados.e3).toBe('ok');
    expect(r.estados.e9).toBe('ok');
  });

  it('bloco sem executor e pulado_ausente e marca o contador de pulado', async () => {
    const executores = BLOCOS_OPS_PURGE.filter((b) => b !== 'e5').map((b) => executor(b, [ok(0)], []));
    const r = await executaOpsPurge({ executores, ...relogio() });
    expect(r.estados.e5).toBe('pulado_ausente');
    expect(r.contagens.e5_pulado).toBe(1);
    expect(r.contagens.e8_pulado).toBe(0);
  });

  it('pulado_incompativel devolvido pelo executor marca pulado; desligado nao marca', async () => {
    const executores: ExecutorBlocoOpsPurge[] = [
      { bloco: 'e8', async lote() { return { estado: 'pulado_incompativel', removidos: 0, retidos: 0, falhos: 0 }; } },
      { bloco: 'e3', async lote() { return { estado: 'desligado', removidos: 0, retidos: 0, falhos: 0 }; } },
    ];
    const r = await executaOpsPurge({ executores, ...relogio() });
    expect(r.contagens.e8_pulado).toBe(1);
    expect(r.contagens.e3_pulado).toBe(0);
    expect(r.estados.e3).toBe('desligado');
  });

  it('continua lotes enquanto remove linhas e para quando um lote nao remove nada', async () => {
    const chamadas: string[] = [];
    const executores = [executor('e3', [ok(500), ok(500), ok(7), ok(0)], chamadas)];
    const r = await executaOpsPurge({ executores, ...relogio() });
    expect(chamadas).toHaveLength(4);
    expect(r.contagens.e3_removidos).toBe(1007);
    expect(r.restante).toBe(false);
  });

  it('para no teto de lotes e marca restante (caso de borda 6, volume alto)', async () => {
    const chamadas: string[] = [];
    const executores = [executor('e3', [ok(10)], chamadas)];
    const r = await executaOpsPurge({ executores, maxLotes: 3, ...relogio() });
    expect(chamadas).toHaveLength(3);
    expect(r.restante).toBe(true);
  });

  it('orcamento esgotado: blocos seguintes ficam nao_executado e o relatorio marca restante', async () => {
    const chamadas: string[] = [];
    const executores = BLOCOS_OPS_PURGE.map((b) => executor(b, [ok(1)], chamadas));
    // Cada leitura do relogio avanca 10 ms; orcamento de 25 ms esgota depois de poucos blocos.
    const r = await executaOpsPurge({ executores, orcamentoMs: 25, ...relogio(10) });
    expect(r.restante).toBe(true);
    expect(Object.values(r.estados)).toContain('nao_executado');
    expect(chamadas.length).toBeLessThan(BLOCOS_OPS_PURGE.length);
  });

  it('retidos e a contagem do ultimo lote (nao soma entre lotes)', async () => {
    const chamadas: string[] = [];
    const executores = [executor('e2', [ok(5, 4), ok(5, 2), ok(0, 2)], chamadas)];
    const r = await executaOpsPurge({ executores, ...relogio() });
    expect(r.contagens.e2_removidos).toBe(10);
    expect(r.contagens.e2_retidos).toBe(2);
  });

  it('ocupado nao conta como pulado e nao deixa restante', async () => {
    const executores: ExecutorBlocoOpsPurge[] = [
      { bloco: 'e4', async lote() { return { estado: 'ocupado', removidos: 0, retidos: 0, falhos: 0 }; } },
    ];
    const r = await executaOpsPurge({ executores, ...relogio() });
    expect(r.estados.e4).toBe('ocupado');
    expect(r.contagens.e4_pulado).toBe(0);
    expect(r.restante).toBe(false);
  });

  it('evento de auditoria tem exatamente as 37 chaves inteiras do catalogo, sem texto livre (CA-H110-15)', async () => {
    const executores = BLOCOS_OPS_PURGE.map((b) => executor(b, [ok(2, 1)], []));
    const r = await executaOpsPurge({ executores, numeroExecucao: 3, ...relogio() });
    const chaves = Object.keys(r.contagens);
    expect(chaves).toHaveLength(37);
    expect(chaves).toContain('run_no');
    for (const chave of chaves) {
      expect(chave).toMatch(/^(run_no|e[1-9]_(removidos|retidos|falhos|pulado))$/);
      expect(Number.isInteger(r.contagens[chave])).toBe(true);
    }
    expect(r.contagens.run_no).toBe(3);
  });

  it('limite de lote fora de 1 a 5000 e recusado', async () => {
    await expect(executaOpsPurge({ executores: [], limiteLote: 0, ...relogio() })).rejects.toThrow(RangeError);
    await expect(executaOpsPurge({ executores: [], limiteLote: 5001, ...relogio() })).rejects.toThrow(RangeError);
  });
});
