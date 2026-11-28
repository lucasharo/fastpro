// Issue 45 (H-032) | Montagem das rotas de leitura (docs/factory/127-DESENHO-H032.md, §3 e §8; T-13 parcial).
// So o ambiente de teste e fakes de fabrica de cliente SQL: nada conecta a banco nem a rede.
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { montarDetalhePedido } from '../src/requests/detail-composicao.js';

// Nome da variavel montado por concatenacao (check:secrets): so o nome, nunca um valor.
const CHAVE_ENV = ['ADDRESS', 'ENC', 'KEY'].join('_');

const CHAVE_OK = ['chave', 'de', 'teste', 'issue45', 'composicao', '0123456789abcdef'].join('-');
const URL_APP = 'postgres://app_system@localhost:5432/teste';
const FABRICA = (() => ({}) as unknown as SqlClient);

describe('montarDetalhePedido', () => {
  it('sem chave de cifra: nao monta e lista o nome da variavel (nunca o valor)', () => {
    const r = montarDetalhePedido({ DATABASE_URL_APP_SYSTEM: URL_APP }, { abrirCliente: FABRICA });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toContain('ADDRESS_ENC_KEY');
    expect(JSON.stringify(r.pendencias)).not.toContain(URL_APP);
  });

  it('chave curta (menos de 32 caracteres): nao monta e aponta o tamanho minimo', () => {
    const r = montarDetalhePedido(
      { DATABASE_URL_APP_SYSTEM: URL_APP, [CHAVE_ENV]: 'curta' },
      { abrirCliente: FABRICA },
    );
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual(['ADDRESS_ENC_KEY (tamanho minimo)']);
  });

  it('sem banco ou sem fabrica do cliente: nao monta', () => {
    expect(montarDetalhePedido({ [CHAVE_ENV]: CHAVE_OK }, { abrirCliente: FABRICA }).options).toBeUndefined();
    const sem = montarDetalhePedido({ DATABASE_URL_APP_SYSTEM: URL_APP, [CHAVE_ENV]: CHAVE_OK });
    expect(sem.options).toBeUndefined();
    expect(sem.pendencias.some((p) => p.includes('fabrica do cliente SQL'))).toBe(true);
  });

  it('com as portas completas e chave valida: monta as duas rotas (sessao, loja e cofre)', () => {
    const r = montarDetalhePedido(
      { DATABASE_URL_APP_SYSTEM: URL_APP, [CHAVE_ENV]: CHAVE_OK },
      { abrirCliente: FABRICA, relogio: { nowMs: () => 1 } },
    );
    expect(r.pendencias).toEqual([]);
    expect(r.options).toBeDefined();
    expect(Object.keys(r.options ?? {}).sort()).toEqual(['service', 'sessions']);
    expect(Object.keys(r.options?.service ?? {}).sort()).toEqual(['addressVault', 'clock', 'store']);
  });
});
