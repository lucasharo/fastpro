// H-107 (Issue 116) | Gestao do catalogo (docs/factory/81-DESENHO-H107.md §1, §4, §6; 77-REFINO-H107.md).
// Logica pura: registro das rotas com catalog.manage, menu so para o Superadmin, validacao por campo (422),
// erros do banco para 409/422/404/403, projecao sem coluna interna e manipulador com porta em memoria.
// Valores sinteticos; sem banco e sem rede.
import { describe, expect, it } from 'vitest';
import {
  ADMIN_CATALOG_PATH,
  ADMIN_ROLES,
  ADMIN_ROUTES,
  ADMIN_ROUTES_H107,
  adminPermissionsOf,
  consoleMenuFor,
  decideAdminGuard,
  handleCatalogAdmin,
  projetarLeituraCatalogo,
  resolveAdminRoute,
  respostaDoErroCatalogo,
  validarAlteracaoCatalogo,
  type AdminGuardRecord,
  type CatalogAdminPort,
  type CatalogPrincipal,
} from '../src/index.js';

const AGORA = Date.UTC(2099, 0, 1, 12);
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL: CatalogPrincipal = { userId: 'u-superadmin', permissions: ['catalog.manage'], aal2: true };

function linha(roles: string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId: `u-${roles.join('-') || 'sem-papel'}`,
    roles,
    permissions: [...adminPermissionsOf(roles)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: AGORA + 60_000,
    totpAtMs: AGORA,
    ...extra,
  };
}

describe('T-H107-01 registro das rotas do catalogo (81 §1)', () => {
  it('todas as rotas do catalogo exigem catalog.manage e so usam GET e POST', () => {
    expect(ADMIN_ROUTES_H107.length).toBe(8);
    for (const rota of ADMIN_ROUTES_H107) {
      expect(rota.permission, rota.pattern).toBe('catalog.manage');
      expect(['GET', 'POST']).toContain(rota.method);
      expect(ADMIN_ROUTES).toContain(rota);
    }
  });

  it('resolve as rotas de criacao, alteracao, desativacao e revisoes; DELETE nao existe', () => {
    expect(resolveAdminRoute(ADMIN_ROUTES, 'GET', ADMIN_CATALOG_PATH)?.pattern).toBe(ADMIN_CATALOG_PATH);
    expect(resolveAdminRoute(ADMIN_ROUTES, 'POST', `${ADMIN_CATALOG_PATH}/services/${ID}`)?.pattern).toBe(
      `${ADMIN_CATALOG_PATH}/services/:id`,
    );
    expect(resolveAdminRoute(ADMIN_ROUTES, 'GET', `${ADMIN_CATALOG_PATH}/groups/${ID}/revisions`)?.pattern).toBe(
      `${ADMIN_CATALOG_PATH}/:entity/:id/revisions`,
    );
    expect(resolveAdminRoute(ADMIN_ROUTES, 'DELETE', `${ADMIN_CATALOG_PATH}/groups/${ID}`)).toBeNull();
  });
});

describe('T-H107-02 permissao e menu (CA-01, CA-02; 81 §1)', () => {
  it('so o Superadmin com aal2 passa pela permissao catalog.manage', () => {
    for (const papel of ADMIN_ROLES) {
      const out = decideAdminGuard(linha([papel]), 'catalog.manage', AGORA);
      if (papel === 'superadmin') expect(out.kind).toBe('autorizada');
      else expect(out.kind, papel).toBe('recusada');
    }
  });

  it('sem aal2 o Superadmin e recusado antes da permissao (404 identico)', () => {
    const out = decideAdminGuard(linha(['superadmin'], { aal2: false }), 'catalog.manage', AGORA);
    expect(out.kind).toBe('recusada');
  });

  it('o item catalogo do menu aparece com a rota so para o Superadmin', () => {
    const menuSuper = consoleMenuFor(adminPermissionsOf(['superadmin']), ADMIN_ROUTES);
    expect(menuSuper.some((t) => t.id === 'catalogo')).toBe(true);
    const menuAuditor = consoleMenuFor(adminPermissionsOf(['auditor']), ADMIN_ROUTES);
    expect(menuAuditor.some((t) => t.id === 'catalogo')).toBe(false);
    // Sem a rota no registro, a tela some mesmo para o Superadmin (CA-H103-11).
    const semRota = consoleMenuFor(adminPermissionsOf(['superadmin']), ADMIN_ROUTES.filter((r) => !ADMIN_ROUTES_H107.includes(r)));
    expect(semRota.some((t) => t.id === 'catalogo')).toBe(false);
  });
});

describe('T-H107-03 validacao antes do banco (422 por campo; 77 CA-03, CA-04)', () => {
  it('criar grupo sem nome nem posicao devolve um motivo por campo', () => {
    const v = validarAlteracaoCatalogo('group', true, { patch: { active: true } });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.resposta.status).toBe(422);
    expect(v.resposta.body).toEqual({
      code: 'dados_invalidos',
      campos: { name: 'obrigatorio', position: 'obrigatorio' },
    });
  });

  it('criar servico valido devolve o patch normalizado (nome aparado, sem expectedVersion)', () => {
    const v = validarAlteracaoCatalogo('service', true, {
      patch: { name: '  Obra  ', group_id: ID, modality: 'online', regulated: false },
    });
    expect(v).toEqual({ ok: true, expectedVersion: null, patch: { name: 'Obra', group_id: ID, modality: 'online', regulated: false } });
  });

  it('alteracao exige expectedVersion inteiro >= 1 e recusa campo fora da lista', () => {
    const semVersao = validarAlteracaoCatalogo('group', false, { patch: { name: 'Ok' } });
    expect(!semVersao.ok && semVersao.resposta.body).toEqual({ code: 'dados_invalidos', campos: { expectedVersion: 'obrigatorio' } });
    const extra = validarAlteracaoCatalogo('group', false, { expectedVersion: 2, patch: { name: 'Ok', seed_key: 'x' } });
    expect(!extra.ok && extra.resposta.body).toEqual({ code: 'dados_invalidos', campos: { seed_key: 'nao_permitido' } });
  });

  it('modalidade fora da lista, posicao fracionada, uuid invalido e booleano como texto: 422 por campo', () => {
    const v = validarAlteracaoCatalogo('service', false, {
      expectedVersion: 1,
      patch: { modality: 'remoto', group_id: 'abc', regulated: 'sim' },
    });
    expect(!v.ok && v.resposta.body).toEqual({
      code: 'dados_invalidos',
      campos: { modality: 'invalido', group_id: 'invalido', regulated: 'invalido' },
    });
    const pos = validarAlteracaoCatalogo('group', false, { expectedVersion: 1, patch: { position: 1.5 } });
    expect(!pos.ok && pos.resposta.body).toEqual({ code: 'dados_invalidos', campos: { position: 'invalido' } });
  });

  it('sinonimo vazio ou so com espacos e recusado; trocar o servico de um sinonimo tambem', () => {
    const vazio = validarAlteracaoCatalogo('synonym', false, { expectedVersion: 1, patch: { term: '   ' } });
    expect(!vazio.ok && vazio.resposta.body).toEqual({ code: 'dados_invalidos', campos: { term: 'invalido' } });
    const troca = validarAlteracaoCatalogo('synonym', false, { expectedVersion: 1, patch: { service_id: ID } });
    expect(!troca.ok && troca.resposta.body).toEqual({ code: 'dados_invalidos', campos: { service_id: 'nao_alteravel' } });
  });

  it('desativar e POST com active false, sem expectedVersion na criacao', () => {
    const v = validarAlteracaoCatalogo('service', false, { expectedVersion: 3, patch: { active: false } });
    expect(v).toEqual({ ok: true, expectedVersion: 3, patch: { active: false } });
  });
});

describe('T-H107-04 erros do banco para resposta (77 CA-04, CA-07; 81 §5)', () => {
  it('CT002 vira 409 com sugestao de ordem; CT003 vira 409 de versao', () => {
    expect(respostaDoErroCatalogo({ code: 'CT002' }, 'service')?.body).toEqual({
      code: 'grupo_sem_servico_ativo',
      campos: { active: 'sem_servico_ativo' },
      sugestao: 'desativar_grupo_antes',
    });
    expect(respostaDoErroCatalogo({ code: 'CT002' }, 'group')?.body).toMatchObject({ sugestao: 'ativar_servico_antes' });
    expect(respostaDoErroCatalogo({ code: 'CT003' }, 'group')).toMatchObject({ status: 409, body: { code: 'versao_em_conflito' } });
  });

  it('sinonimo duplicado (23505) vira 409 no campo term com sugestao de reativar', () => {
    expect(respostaDoErroCatalogo({ code: '23505' }, 'synonym')).toMatchObject({
      status: 409,
      body: { code: 'sinonimo_duplicado', campos: { term: 'ja_existe' }, sugestao: 'reativar' },
    });
  });

  it('CT005 vira 404, 42501 vira 403, CT004 vira 422 e 23503 aponta o campo de referencia', () => {
    expect(respostaDoErroCatalogo({ code: 'CT005' }, 'group')?.status).toBe(404);
    expect(respostaDoErroCatalogo({ code: '42501' }, 'group')?.status).toBe(403);
    expect(respostaDoErroCatalogo({ code: 'CT004' }, 'group')?.status).toBe(422);
    expect(respostaDoErroCatalogo({ code: '23503' }, 'service')?.body).toEqual({
      code: 'referencia_invalida',
      campos: { group_id: 'nao_encontrado' },
    });
  });

  it('erro fora do catalogo nao e convertido (nulo) e sobe no manipulador', async () => {
    expect(respostaDoErroCatalogo({ code: 'XX000' }, 'group')).toBeNull();
    const porta = fakePorta({ salvar: async () => { throw Object.assign(new Error('falha'), { code: 'XX000' }); } });
    await expect(
      handleCatalogAdmin({ kind: 'salvar', entidade: 'group', id: null, corpo: { patch: { name: 'A', position: 1 } } }, PRINCIPAL, porta),
    ).rejects.toThrow('falha');
  });
});

function fakePorta(sobrescritas: Partial<CatalogAdminPort> = {}): CatalogAdminPort {
  return {
    listar: async () => ({ groups: [], services: [], synonyms: [] }),
    salvar: async () => ID,
    revisoes: async () => [],
    ...sobrescritas,
  };
}

describe('T-H107-05 manipulador e projecao (CA-07; 81 §1 e §4)', () => {
  it('leitura da tela nao devolve coluna interna (semente, conselho, fonte, sensivel, ator)', async () => {
    const bruto = {
      groups: [{ id: ID, name: 'Saude', position: 1, active: true, version: 2, seed_key: 'x', updated_by_ref: 'admin:y' }],
      services: [
        {
          id: ID2,
          group_id: ID,
          name: 'Obra',
          modality: 'presencial',
          regulated: true,
          active: true,
          version: 1,
          council_body: 'CRM',
          regulation_source: 'juridico',
          moderation_sensitive: true,
        },
      ],
      synonyms: [{ id: ID, service_id: ID2, term: 'construcao', active: true, version: 1, term_norm: 'construcao' }],
    };
    const out = projetarLeituraCatalogo(bruto);
    const texto = JSON.stringify(out);
    for (const interno of ['seed_key', 'updated_by_ref', 'council_body', 'regulation_source', 'moderation_sensitive', 'term_norm']) {
      expect(texto).not.toContain(interno);
    }
    expect(out.servicos[0]).toEqual({
      id: ID2,
      group_id: ID,
      name: 'Obra',
      modality: 'presencial',
      regulated: true,
      active: true,
      version: 1,
    });
  });

  it('leitura malformada lanca erro (a API responde 503 sem detalhe)', () => {
    expect(() => projetarLeituraCatalogo({ groups: 'x', services: [], synonyms: [] })).toThrow('catalogo_leitura_invalida');
  });

  it('criacao devolve 201 com o id; alteracao devolve 200; passa a versao e o patch ao banco', async () => {
    const chamadas: unknown[] = [];
    const porta = fakePorta({
      salvar: async (...args) => {
        chamadas.push(args);
        return ID;
      },
    });
    const criado = await handleCatalogAdmin(
      { kind: 'salvar', entidade: 'group', id: null, corpo: { patch: { name: 'Saude', position: 1 } } },
      PRINCIPAL,
      porta,
    );
    expect(criado).toMatchObject({ status: 201, body: { id: ID } });
    const alterado = await handleCatalogAdmin(
      { kind: 'salvar', entidade: 'group', id: ID, corpo: { expectedVersion: 4, patch: { active: false } } },
      PRINCIPAL,
      porta,
    );
    expect(alterado).toMatchObject({ status: 200, body: { id: ID } });
    expect(chamadas).toEqual([
      [PRINCIPAL, 'group', null, null, { name: 'Saude', position: 1 }],
      [PRINCIPAL, 'group', ID, 4, { active: false }],
    ]);
  });

  it('id de caminho que nao e identificador, ou entidade de revisao desconhecida, vira 404', async () => {
    const porta = fakePorta();
    const r1 = await handleCatalogAdmin({ kind: 'salvar', entidade: 'group', id: 'x', corpo: {} }, PRINCIPAL, porta);
    expect(r1.status).toBe(404);
    const r2 = await handleCatalogAdmin({ kind: 'revisoes', entidadeRota: 'constructor', id: ID }, PRINCIPAL, porta);
    expect(r2.status).toBe(404);
  });

  it('revisoes: antes e depois saem so com campos visiveis; ator vem do campo de revisao', async () => {
    const porta = fakePorta({
      revisoes: async () => [
        {
          version: 2,
          before: { id: ID, name: 'A', position: 1, active: true, version: 1, seed_key: 'x' },
          after: { id: ID, name: 'B', position: 1, active: true, version: 2, seed_key: 'x' },
          at: '2099-01-01T12:00:00.000Z',
          actor: 'admin:u-superadmin',
        },
      ],
    });
    const out = await handleCatalogAdmin({ kind: 'revisoes', entidadeRota: 'groups', id: ID }, PRINCIPAL, porta);
    expect(out.status).toBe(200);
    expect(JSON.stringify(out.body)).not.toContain('seed_key');
    expect(out.body).toEqual({
      revisoes: [
        {
          versao: 2,
          antes: { id: ID, name: 'A', position: 1, active: true, version: 1 },
          depois: { id: ID, name: 'B', position: 1, active: true, version: 2 },
          em: '2099-01-01T12:00:00.000Z',
          ator: 'admin:u-superadmin',
        },
      ],
    });
  });
});
