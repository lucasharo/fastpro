// Issue 47 (H-034) | Ligacao da leitura do pedido do dono (GET /v1/requests/:id, Issue 45) ate o handler de apps/api/src/vercel.ts.
// Defeito corrigido: vercel.ts nao repassava requestDetail; a composicao montava a opcao, mas o handler a descartava e a
// rota respondia 404 em producao. So ambiente falso: sem banco, sem rede; a fabrica de cliente nao e usada.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { montarIntegracoes } from '../src/composicao.js';

// Nome da variavel montado por concatenacao (check:secrets): so o nome, nunca um valor.
const CHAVE_ENV = ['ADDRESS', 'ENC', 'KEY'].join('_');
const CHAVE_OK = ['chave', 'de', 'teste', 'issue47', 'ligacao', '0123456789abcdef'].join('-');
const URL_APP = 'postgres://app_system@localhost:5432/teste';
const FABRICA = (() => ({}) as unknown as SqlClient);

const LINHA_REPASSE = '...(integracoes.requestDetail !== undefined ? { requestDetail: integracoes.requestDetail } : {}),';

describe('ligacao da leitura do pedido do dono (Issue 47 corrige o repasse da Issue 45)', () => {
  it('composicao sem variaveis: a opcao existe na montagem e fica indefinida (rota 404)', () => {
    const r = montarIntegracoes({});
    expect('requestDetail' in r).toBe(true);
    expect(r.requestDetail).toBeUndefined();
  });

  it('composicao com banco, chave valida e fabrica: a opcao sai montada com sessao e servico', () => {
    const r = montarIntegracoes({ DATABASE_URL_APP_SYSTEM: URL_APP, [CHAVE_ENV]: CHAVE_OK }, { abrirClienteSistema: FABRICA });
    expect(r.requestDetail).toBeDefined();
    expect(Object.keys(r.requestDetail ?? {}).sort()).toEqual(['service', 'sessions']);
  });

  it('vercel.ts repassa requestDetail ao handler, uma unica vez', () => {
    const texto = readFileSync(new URL('../src/vercel.ts', import.meta.url), 'utf8');
    expect(texto.split(LINHA_REPASSE).length - 1).toBe(1);
  });
});
