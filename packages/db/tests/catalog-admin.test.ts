// H-107 (Issue 116) | Adaptador Pg da gestao do catalogo com cliente falso (docs/factory/81-DESENHO-H107.md §1, §6).
// Confere a ponte de identidade (set_config com os valores da guarda), a ordem dos parametros, uma instrucao
// por operacao (sem begin/commit entre chamadas) e a passagem do SQLSTATE do banco. Sem banco e sem rede.
import { describe, expect, it } from 'vitest';
import { PgCatalogAdminPort, type SqlClient } from '../src/index.js';
import type { CatalogPrincipal } from '@fastpro/domain';

const ID = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL: CatalogPrincipal = { userId: ID, permissions: ['catalog.manage', 'ops.panel.read'], aal2: true };

interface Chamada {
  readonly sql: string;
  readonly params: readonly unknown[] | undefined;
}

function clienteFalso(resposta: (sql: string) => Record<string, unknown>[] | Error): { client: SqlClient; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const client: SqlClient = {
    query: async (sql: string, params?: unknown[]) => {
      chamadas.push({ sql, params });
      const r = resposta(sql);
      if (r instanceof Error) throw r;
      return { rows: r };
    },
  };
  return { client, chamadas };
}

describe('T-H107-DB catalogo pelo adaptador Pg (cliente falso)', () => {
  it('cada operacao e uma instrucao com a ponte de identidade do servidor (sem begin ou commit)', async () => {
    const { client, chamadas } = clienteFalso(() => [{ id: ID }]);
    await new PgCatalogAdminPort(client).salvar(PRINCIPAL, 'service', null, null, { name: 'Obra', group_id: ID });
    expect(chamadas).toHaveLength(1);
    const [c] = chamadas;
    expect(c?.sql).toContain("set_config('app.principal_type', 'admin', true)");
    expect(c?.sql).toContain('private.catalog_service_save($4::uuid, $5::integer, $6::jsonb)');
    expect(c?.sql).not.toMatch(/\bbegin\b|\bcommit\b/);
    expect(c?.params).toEqual([ID, 'catalog.manage,ops.panel.read', 'aal2', null, null, JSON.stringify({ name: 'Obra', group_id: ID })]);
  });

  it('o aal vai como aal1 quando a sessao nao tem o segundo fator (a funcao recusa)', async () => {
    const { client, chamadas } = clienteFalso(() => [{ leitura: {} }]);
    await new PgCatalogAdminPort(client).listar({ ...PRINCIPAL, aal2: false });
    expect(chamadas[0]?.params?.[2]).toBe('aal1');
  });

  it('cada entidade chama a sua funcao de escrita, e a alteracao passa id e versao', async () => {
    const { client, chamadas } = clienteFalso(() => [{ id: ID }]);
    const porta = new PgCatalogAdminPort(client);
    await porta.salvar(PRINCIPAL, 'group', ID, 3, { active: false });
    await porta.salvar(PRINCIPAL, 'synonym', null, null, { service_id: ID, term: 'obra' });
    expect(chamadas[0]?.sql).toContain('private.catalog_group_save(');
    expect(chamadas[0]?.params?.slice(3)).toEqual([ID, 3, JSON.stringify({ active: false })]);
    expect(chamadas[1]?.sql).toContain('private.catalog_synonym_save(');
  });

  it('leitura e revisoes chamam as funcoes certas com a entidade e o identificador', async () => {
    const { client, chamadas } = clienteFalso((sql) => (sql.includes('catalog_admin_list') ? [{ leitura: { groups: [] } }] : [{ revisoes: [] }]));
    const porta = new PgCatalogAdminPort(client);
    expect(await porta.listar(PRINCIPAL)).toEqual({ groups: [] });
    expect(await porta.revisoes(PRINCIPAL, 'service', ID)).toEqual([]);
    expect(chamadas[1]?.sql).toContain('private.catalog_revision_list($4::text, $5::uuid)');
    expect(chamadas[1]?.params?.slice(3)).toEqual(['service', ID]);
  });

  it('erro do banco sobe com o SQLSTATE em code, sem alterar a mensagem', async () => {
    const erro = Object.assign(new Error('catalogo: versao em conflito'), { code: 'CT003' });
    const { client } = clienteFalso(() => erro);
    await expect(new PgCatalogAdminPort(client).salvar(PRINCIPAL, 'group', ID, 1, { name: 'A' })).rejects.toMatchObject({
      code: 'CT003',
    });
  });

  it('resposta sem a coluna esperada lanca erro (a API responde 503)', async () => {
    const { client } = clienteFalso(() => [{}]);
    await expect(new PgCatalogAdminPort(client).listar(PRINCIPAL)).rejects.toThrow('catalogo_resposta_invalida');
  });
});
