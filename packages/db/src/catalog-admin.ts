// H-107 (Issue 116) | Adaptador Pg da gestao do catalogo (docs/factory/81-DESENHO-H107.md §1 e §2).
// Chama so as funcoes private.catalog_* (papel app_system). Cada operacao e UMA instrucao: a ponte de identidade
// (set_config local a transacao) e a funcao rodam na mesma transacao implicita, sem begin/commit entre chamadas
// (o cliente da API e um pool; varias chamadas podem cair em conexoes diferentes). A verificacao de
// administrador continua no banco (catalog_assert_admin). Erro do banco sobe com o SQLSTATE em `code`;
// quem traduz para resposta e o dominio (respostaDoErroCatalogo).
import type { CatalogAdminPort, CatalogEntity, CatalogPrincipal } from '@fastpro/domain';
import type { SqlClient } from './jobs-tick.js';

/**
 * Ponte de identidade: os valores vem da guarda do servidor (userId, permissoes, aal2). A CTE e volatil, entao o
 * Postgres a executa antes da funcao; o filtro abaixo referencia as quatro colunas para que todas sejam calculadas.
 */
const CONTEXTO = `with ctx as (
  select set_config('app.principal_type', 'admin', true) as tipo,
         set_config('app.principal_id', $1::text, true) as principal,
         set_config('app.permissions', $2::text, true) as permissoes,
         set_config('app.aal', $3::text, true) as aal
)`;
const FILTRO_CONTEXTO = `where ctx.tipo = 'admin' and ctx.principal = $1::text and ctx.permissoes = $2::text and ctx.aal = $3::text`;

const FUNCAO_SALVAR: Readonly<Record<CatalogEntity, string>> = {
  group: 'private.catalog_group_save',
  service: 'private.catalog_service_save',
  synonym: 'private.catalog_synonym_save',
};

const SQL_LISTAR = `${CONTEXTO} select private.catalog_admin_list() as leitura from ctx ${FILTRO_CONTEXTO}`;
const SQL_REVISOES = `${CONTEXTO} select private.catalog_revision_list($4::text, $5::uuid) as revisoes from ctx ${FILTRO_CONTEXTO}`;

function parametrosDoContexto(principal: CatalogPrincipal): string[] {
  return [principal.userId, principal.permissions.join(','), principal.aal2 ? 'aal2' : 'aal1'];
}

function unica(rows: readonly Record<string, unknown>[], campo: string): unknown {
  const valor = rows[0]?.[campo];
  if (valor === undefined || valor === null) throw new Error('catalogo_resposta_invalida');
  return valor;
}

/** Porta de banco da tela do catalogo: leitura completa, criacao/alteracao e historico de um item. */
export class PgCatalogAdminPort implements CatalogAdminPort {
  constructor(private readonly client: SqlClient) {}

  async listar(principal: CatalogPrincipal): Promise<unknown> {
    const res = await this.client.query(SQL_LISTAR, parametrosDoContexto(principal));
    return unica(res.rows, 'leitura');
  }

  async salvar(
    principal: CatalogPrincipal,
    entidade: CatalogEntity,
    id: string | null,
    expectedVersion: number | null,
    patch: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const sql = `${CONTEXTO} select ${FUNCAO_SALVAR[entidade]}($4::uuid, $5::integer, $6::jsonb) as id from ctx ${FILTRO_CONTEXTO}`;
    const res = await this.client.query(sql, [
      ...parametrosDoContexto(principal),
      id,
      expectedVersion,
      JSON.stringify(patch),
    ]);
    const salvo = unica(res.rows, 'id');
    if (typeof salvo !== 'string') throw new Error('catalogo_resposta_invalida');
    return salvo;
  }

  async revisoes(principal: CatalogPrincipal, entidade: CatalogEntity, id: string): Promise<unknown> {
    const res = await this.client.query(SQL_REVISOES, [...parametrosDoContexto(principal), entidade, id]);
    return unica(res.rows, 'revisoes');
  }
}
