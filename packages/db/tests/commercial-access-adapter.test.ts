// H-045 (Issue 58) | Testes do adaptador Pg do acesso comercial (114-DESENHO-H045 §6, T-20) com cliente falso.
// Sem banco e sem rede: prova parametros posicionais, conversao de datas, validacao do estado e codigo fixo de erro.
import { describe, it, expect } from 'vitest';
import { CommercialAccessError } from '@fastpro/domain';
import { SQL_COMMERCIAL_ACCESS, createPgCommercialAccess } from '../src/commercial-access.js';
import type { SqlClient } from '../src/jobs-tick.js';

const PROFISSIONAL = '11111111-2222-4333-8444-555555555555';
const AT = new Date('2030-03-01T10:00:00.000Z');

function clienteFalso(resposta: () => Promise<{ rows: Record<string, unknown>[] }>) {
  const chamadas: Array<{ text: string; params: unknown[] | undefined }> = [];
  const client: SqlClient = {
    query: (text, params) => {
      chamadas.push({ text, params });
      return resposta();
    },
  };
  return { client, chamadas };
}

describe('createPgCommercialAccess', () => {
  it('usa so o SQL fixo com parametros posicionais e instante em ISO-8601', async () => {
    const { client, chamadas } = clienteFalso(async () => ({
      rows: [{ estado: 'ativa', access_until: new Date('2030-03-31T00:00:00.000Z') }],
    }));
    await createPgCommercialAccess(client).read(PROFISSIONAL, AT);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.text).toBe(SQL_COMMERCIAL_ACCESS);
    expect(SQL_COMMERCIAL_ACCESS).toBe(
      'select estado, access_until from private.commercial_access($1::uuid, $2::timestamptz)',
    );
    expect(chamadas[0]?.params).toEqual([PROFISSIONAL, '2030-03-01T10:00:00.000Z']);
  });

  it('converte access_until vindo como texto e aceita nulo', async () => {
    const texto = clienteFalso(async () => ({
      rows: [{ estado: 'em_carencia', access_until: '2030-03-04T10:00:00.000Z' }],
    }));
    const r1 = await createPgCommercialAccess(texto.client).read(PROFISSIONAL, AT);
    expect(r1).toEqual({ estado: 'em_carencia', accessUntil: new Date('2030-03-04T10:00:00.000Z') });

    const nulo = clienteFalso(async () => ({ rows: [{ estado: 'sem_acesso', access_until: null }] }));
    const r2 = await createPgCommercialAccess(nulo.client).read(PROFISSIONAL, AT);
    expect(r2).toEqual({ estado: 'sem_acesso', accessUntil: null });
  });

  it('rejeita estado fora dos sete valores como acesso_comercial_invalido', async () => {
    const { client } = clienteFalso(async () => ({ rows: [{ estado: 'bloqueado', access_until: null }] }));
    await expect(createPgCommercialAccess(client).read(PROFISSIONAL, AT)).rejects.toMatchObject({
      code: 'acesso_comercial_invalido',
    });
  });

  it('rejeita resposta sem linha e data invalida', async () => {
    const vazio = clienteFalso(async () => ({ rows: [] }));
    await expect(createPgCommercialAccess(vazio.client).read(PROFISSIONAL, AT)).rejects.toMatchObject({
      code: 'acesso_comercial_invalido',
    });
    const dataRuim = clienteFalso(async () => ({ rows: [{ estado: 'ativa', access_until: 'nao-data' }] }));
    await expect(createPgCommercialAccess(dataRuim.client).read(PROFISSIONAL, AT)).rejects.toMatchObject({
      code: 'acesso_comercial_invalido',
    });
  });

  it('erro do banco vira codigo fixo, sem repassar a mensagem original', async () => {
    const segredo = 'detalhe interno do banco 42P01 relation secreta';
    const { client } = clienteFalso(async () => {
      throw new Error(segredo);
    });
    const erro = await createPgCommercialAccess(client)
      .read(PROFISSIONAL, AT)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(CommercialAccessError);
    expect((erro as CommercialAccessError).code).toBe('acesso_comercial_indisponivel');
    expect((erro as Error).message).not.toContain(segredo);
  });
});
