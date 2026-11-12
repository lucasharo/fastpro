// H-108 (Issue 117) | Ligacao do painel operacional na composicao (src/admin-composicao.ts) e leitura Pg
// (PgOpsPanelReader) com cliente SQL falso. Sem banco, sem rede. Valores sinteticos.
import { describe, expect, it } from 'vitest';
import { PgOpsPanelReader, type SqlClient } from '@fastpro/db';
import { montarPainelOperacional } from '../src/admin-composicao.js';

const SENHA_SINTETICA = ['senha', 'sintetica'].join('-');
// A composicao memoiza um cliente por string de conexao: cada teste usa uma URL propria (cliente novo).
let sequencia = 0;
const novaUrl = (): string => {
  sequencia += 1;
  return `postgres://papel-sintetico:${SENHA_SINTETICA}@127.0.0.1:1/banco-sintetico-${sequencia}`;
};
const SEGREDO = 'example-admin-secret-painel-composicao-0000';
const T0 = Date.UTC(2099, 0, 1, 12);

const LEITURA_SINTETICA = {
  fila: { por_estado: { pendente: 1 }, idade_pendente_s: 60, falhas_por_codigo: {} },
  cotas: [],
  metricas: [],
};

function clienteFalso(linhas: Record<string, unknown>[] = []) {
  const chamadas: { text: string; params: unknown[] }[] = [];
  const cliente: SqlClient = {
    async query(text: string, params: unknown[] = []) {
      chamadas.push({ text, params });
      return { rows: linhas };
    },
  };
  return { cliente, chamadas };
}

describe('montarPainelOperacional: so monta com DATABASE_URL_APP_SYSTEM e a fabrica da borda', () => {
  it('sem a variavel ou sem a fabrica: nada e montado (rota segue 404) e a fabrica nao e chamada', () => {
    let chamou = 0;
    const fabrica = () => {
      chamou += 1;
      return clienteFalso().cliente;
    };
    expect(montarPainelOperacional({}, { abrirCliente: fabrica })).toBeUndefined();
    expect(montarPainelOperacional({ DATABASE_URL_APP_SYSTEM: novaUrl() })).toBeUndefined();
    expect(chamou).toBe(0);
  });

  it('com a variavel e a fabrica: devolve guarda, leitura e relogio; a leitura so usa o papel informado', async () => {
    const { cliente, chamadas } = clienteFalso([{ leitura: LEITURA_SINTETICA }]);
    const r = montarPainelOperacional(
      { DATABASE_URL_APP_SYSTEM: novaUrl() },
      { abrirCliente: () => cliente, relogio: { nowMs: () => T0 } },
    );
    expect(r).toBeDefined();
    expect(r?.clock.nowMs()).toBe(T0);

    const lido = await r!.ler(T0);
    expect(lido).toEqual(LEITURA_SINTETICA);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.text).toBe('select private.ops_panel_read($1::timestamptz) as leitura');
    expect(chamadas[0]!.params).toEqual([new Date(T0).toISOString()]);
  });

  it('a guarda nao manda o segredo em claro ao banco (so o hash)', async () => {
    const { cliente, chamadas } = clienteFalso([]);
    const r = montarPainelOperacional(
      { DATABASE_URL_APP_SYSTEM: novaUrl() },
      { abrirCliente: () => cliente, relogio: { nowMs: () => T0 } },
    );
    const row = await r!.guard(SEGREDO, T0);
    expect(row).toBeNull();
    expect(chamadas.length).toBeGreaterThan(0);
    for (const c of chamadas) {
      expect(JSON.stringify(c.params)).not.toContain(SEGREDO);
    }
  });

  it('as opcoes montadas nao carregam a string de conexao', () => {
    const { cliente } = clienteFalso();
    const url = novaUrl();
    const r = montarPainelOperacional({ DATABASE_URL_APP_SYSTEM: url }, { abrirCliente: () => cliente });
    expect(JSON.stringify(Object.keys(r ?? {}))).not.toContain('postgres://');
    expect(JSON.stringify(r?.clock ?? null)).not.toContain(SENHA_SINTETICA);
  });
});

describe('PgOpsPanelReader: uma chamada fixa a funcao, sem concatenacao', () => {
  it('erro do banco sobe como esta (a rota responde 503 sem detalhe)', async () => {
    const cliente: SqlClient = {
      async query() {
        throw new Error('falha sintetica do banco');
      },
    };
    await expect(new PgOpsPanelReader(cliente).ler(T0)).rejects.toThrow('falha sintetica do banco');
  });

  it('resposta sem o objeto leitura (linha vazia ou valor nulo) lanca erro, nunca devolve vazio', async () => {
    await expect(new PgOpsPanelReader(clienteFalso([]).cliente).ler(T0)).rejects.toThrow('ops_painel_resposta_invalida');
    await expect(
      new PgOpsPanelReader(clienteFalso([{ leitura: null }]).cliente).ler(T0),
    ).rejects.toThrow('ops_painel_resposta_invalida');
  });
});
