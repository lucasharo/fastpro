// H-073 (Issue 83) | Montagem das rotas de caso (src/admin-composicao.ts): so com os nomes presentes e a fabrica da
// borda. Cliente SQL falso; sem banco, sem rede. Valores sinteticos; nenhum valor de ambiente e impresso.
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { montarAdministracaoCaso } from '../src/admin-composicao.js';

const URL_SINTETICA = 'postgres://papel-sintetico:senha-sintetica@127.0.0.1:1/banco-sintetico';
const BASE = 'https://admin.fastpro.example.test';
const T0 = Date.UTC(2099, 0, 1, 12);

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

describe('montarAdministracaoCaso: so monta com os nomes e a fabrica da borda', () => {
  it('sem as variaveis (ambiente vazio): nada e montado e a fabrica nao e chamada', () => {
    let abriu = 0;
    const r = montarAdministracaoCaso({}, {
      abrirCliente: () => {
        abriu += 1;
        return clienteFalso().cliente;
      },
    });
    expect(r).toBeUndefined();
    expect(abriu).toBe(0);
  });

  it('so uma das duas variaveis presente: nada e montado', () => {
    expect(montarAdministracaoCaso({ DATABASE_URL_APP_SYSTEM: URL_SINTETICA }, { abrirCliente: () => clienteFalso().cliente })).toBeUndefined();
    expect(montarAdministracaoCaso({ ADMIN_BASE_URL: BASE }, { abrirCliente: () => clienteFalso().cliente })).toBeUndefined();
  });

  it('variaveis presentes mas sem fabrica da borda: nada e montado (a rota segue 404)', () => {
    expect(montarAdministracaoCaso({ DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE })).toBeUndefined();
  });

  it('completo: devolve as opcoes; a guarda usa o cliente da borda com hash do segredo', async () => {
    const { cliente, chamadas } = clienteFalso([
      {
        out_user_id: 'u-sintetico',
        out_roles: ['suporte'],
        out_permissions: ['case.open_sensitive'],
        out_totp_at: new Date(T0),
        out_expires_at: new Date(T0 + 60 * 60 * 1000),
      },
    ]);
    const r = montarAdministracaoCaso(
      { DATABASE_URL_APP_SYSTEM: 'postgres://outra-sintetica/banco', ADMIN_BASE_URL: BASE },
      { abrirCliente: () => cliente, relogio: { nowMs: () => T0 }, novoIdCaso: () => 'id-sintetico' },
    );
    expect(r).toBeDefined();
    expect(r?.baseUrl).toBe(BASE);
    expect(r?.clock.nowMs()).toBe(T0);
    expect(r?.deps.newCaseId()).toBe('id-sintetico');
    const linha = await r!.guard('SEGREDO-SINTETICO-COMPOSICAO', T0);
    expect(linha?.userId).toBe('u-sintetico');
    expect(linha?.permissions).toEqual(['case.open_sensitive']);
    expect(chamadas[0]?.text).toContain('private.admin_guard(');
    expect(JSON.stringify(chamadas)).not.toContain('SEGREDO-SINTETICO-COMPOSICAO');
  });

  it('um cliente por string de conexao: a fabrica nao e chamada de novo na segunda montagem', () => {
    const url = 'postgres://memo-sintetica/banco';
    let abriu = 0;
    const fabrica = () => {
      abriu += 1;
      return clienteFalso().cliente;
    };
    const env = { DATABASE_URL_APP_SYSTEM: url, ADMIN_BASE_URL: BASE };
    montarAdministracaoCaso(env, { abrirCliente: fabrica });
    montarAdministracaoCaso(env, { abrirCliente: fabrica });
    expect(abriu).toBe(1);
  });

  it('as opcoes montadas nao carregam a string de conexao', () => {
    const r = montarAdministracaoCaso(
      { DATABASE_URL_APP_SYSTEM: URL_SINTETICA, ADMIN_BASE_URL: BASE },
      { abrirCliente: () => clienteFalso().cliente },
    );
    expect(JSON.stringify(r)).not.toContain('senha-sintetica');
    expect(JSON.stringify(r)).not.toContain(URL_SINTETICA);
  });
});
