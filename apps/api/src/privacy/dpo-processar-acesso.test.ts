// Issue 120 (H-111) | Testes do processamento do caso de acesso pelo DPO (P-B 3, 147 §4.3). Sem banco e sem rede:
// porta SQL e gerador do extrato falsos. Cobre: extrato gera e encerra; sem gerador segue 409; falha nao vira sucesso;
// processamento comum (eliminacao) nao chama o gerador.
import { describe, expect, it } from 'vitest';
import { DsrDpoSql, ServicoDsrDpo } from './dpo-service.js';

const ATOR = '33333333-3333-4333-8333-333333333333';
const CASO = '44444444-4444-4444-8444-444444444444';
const EXPIRA = '2026-11-28T00:00:00.000Z';

function sqlFalso(processar: DsrDpoSql['processar']): DsrDpoSql {
  const nao = async () => {
    throw new Error('nao_usado_neste_teste');
  };
  return { listar: nao, obter: nao, abrir: nao, atribuir: nao, recusar: nao, processar } as unknown as DsrDpoSql;
}

const RECUSA_ACESSO = async () => {
  throw new Error('dsr_acesso_usa_extrato');
};

describe('processar caso de acesso pelo DPO (P-B 3)', () => {
  it('gera o extrato e encerra o caso quando o banco recusa o processamento comum', async () => {
    const chamadas: string[] = [];
    const extrato = {
      async gerar(ator: string, caso: string) {
        chamadas.push(`${ator}|${caso}`);
        return { expiresAt: EXPIRA };
      },
    };
    const r = await new ServicoDsrDpo(sqlFalso(RECUSA_ACESSO), extrato).processar(ATOR, CASO);
    expect(r.status).toBe(200);
    expect(r.corpo).toEqual({ id: CASO, status: 'concluido', outcome: 'extrato_disponibilizado', expires_at: EXPIRA });
    expect(chamadas).toEqual([`${ATOR}|${CASO}`]);
  });

  it('sem gerador, o caso de acesso segue recusado com 409 e codigo fixo', async () => {
    await expect(new ServicoDsrDpo(sqlFalso(RECUSA_ACESSO)).processar(ATOR, CASO)).rejects.toMatchObject({
      status: 409,
      corpo: { code: 'dsr_acesso_usa_extrato' },
    });
  });

  it('falha do gerador nao vira sucesso: o erro segue para a rota, que responde 503 fixo', async () => {
    const extrato = {
      async gerar() {
        throw new Error('falha de armazenamento sintetica');
      },
    };
    await expect(new ServicoDsrDpo(sqlFalso(RECUSA_ACESSO), extrato).processar(ATOR, CASO)).rejects.toThrow(
      'falha de armazenamento sintetica',
    );
  });

  it('processamento comum (eliminacao) nao chama o gerador', async () => {
    let gerou = false;
    const extrato = {
      async gerar() {
        gerou = true;
        return { expiresAt: EXPIRA };
      },
    };
    const sql = sqlFalso(async () => ({ out_case_id: CASO, out_status: 'concluido', out_outcome: 'anonimizado' }));
    const r = await new ServicoDsrDpo(sql, extrato).processar(ATOR, CASO);
    expect(r).toEqual({ status: 200, corpo: { id: CASO, status: 'concluido', outcome: 'anonimizado' } });
    expect(gerou).toBe(false);
  });

  it('defere antes do efeito: deferimento, depois processamento comum e extrato (147 §4.3)', async () => {
    const ordem: string[] = [];
    const sql = {
      ...sqlFalso(async () => {
        ordem.push('processar');
        throw new Error('dsr_acesso_usa_extrato');
      }),
      async deferir() {
        ordem.push('deferir');
        return { out_case_id: CASO, out_status: 'deferido' };
      },
    } as DsrDpoSql;
    const extrato = {
      async gerar() {
        ordem.push('extrato');
        return { expiresAt: EXPIRA };
      },
    };
    const r = await new ServicoDsrDpo(sql, extrato).processar(ATOR, CASO);
    expect(r.status).toBe(200);
    expect(ordem).toEqual(['deferir', 'processar', 'extrato']);
  });

  it('caso ja deferido: a recusa do deferimento (dsr_nao_deferivel) nao interrompe o processamento', async () => {
    const sql = {
      ...sqlFalso(async () => ({ out_case_id: CASO, out_status: 'concluido', out_outcome: 'anonimizado' })),
      async deferir() {
        throw new Error('dsr_nao_deferivel');
      },
    } as DsrDpoSql;
    const r = await new ServicoDsrDpo(sql).processar(ATOR, CASO);
    expect(r).toEqual({ status: 200, corpo: { id: CASO, status: 'concluido', outcome: 'anonimizado' } });
  });

  it('outro erro do deferimento (ex.: permissao) segue para a rota e nada e processado', async () => {
    let processou = false;
    const sql = {
      ...sqlFalso(async () => {
        processou = true;
        return {};
      }),
      async deferir() {
        throw new Error('permissao_negada');
      },
    } as DsrDpoSql;
    await expect(new ServicoDsrDpo(sql).processar(ATOR, CASO)).rejects.toMatchObject({ status: 403 });
    expect(processou).toBe(false);
  });
});
