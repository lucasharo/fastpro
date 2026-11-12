// H-103 (Issue 112) | Console admin por papel (docs/factory/70-DESENHO-H103.md §4 e 69-REFINO-H103.md §3).
// T-H103-01 menu por papel, T-H103-02 uniao, T-H103-03 tela sem rota, T-H103-04 coerencia com a guarda,
// T-H103-05 matriz de chamada direta, T-H103-06 revogacao, T-H103-07 resposta do menu.
// Logica pura e em memoria: sem banco, sem rede. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import {
  ADMIN_ACCESS_CASES_PATH,
  ADMIN_AUDIT_QUERY_PATH,
  ADMIN_CONSOLE_SCREENS,
  ADMIN_HEADERS,
  ADMIN_NOT_FOUND,
  ADMIN_PERMISSION_DENIED,
  ADMIN_ROLES,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_ROUTES,
  adminPermissionsOf,
  consoleMenuFor,
  decideAdminGuard,
  handleConsoleMenu,
  resolveAdminRoute,
  type AdminGuardRecord,
  type AdminRouteSpec,
} from '../src/admin/index.js';
import { SYNTH_NOW } from './admin-fakes.js';

type Tela = { readonly id: string; readonly rotulo: string; readonly caminho: string };

/** Linha que o banco devolveria pela guarda: permissoes = uniao dos papeis (como em adminPermissionsOf). */
function linha(papeis: readonly string[], extra: Partial<AdminGuardRecord> = {}): AdminGuardRecord {
  return {
    userId: 'u-teste',
    roles: papeis,
    permissions: [...adminPermissionsOf(papeis)].sort(),
    aal2: true,
    active: true,
    expiresAtMs: SYNTH_NOW + 3600_000,
    totpAtMs: SYNTH_NOW,
    ...extra,
  };
}

/** Ids do menu devolvido pelo manipulador (200). Falha se a resposta nao for 200. */
function menuDe(
  row: AdminGuardRecord | null,
  registro: readonly AdminRouteSpec[] = ADMIN_ROUTES,
): string[] {
  const out = handleConsoleMenu({ row, registro }, SYNTH_NOW);
  expect(out.status).toBe(200);
  return (out.body.telas as readonly Tela[]).map((t) => t.id);
}

const ESPERADO_POR_PAPEL: Record<string, readonly string[]> = {
  // Fila, denuncias, financeiro e suporte: a rota ainda nao esta no registro (CA-H103-11, D-H103-3).
  verificacao: [],
  moderador: [],
  financeiro: [],
  suporte: ['acesso-excepcional'],
  auditor: ['auditoria'],
  superadmin: ['acesso-aprovacao', 'operacao', 'equipe', 'catalogo'],
};

describe('T-H103-01 menu por papel (CA-H103-01..06)', () => {
  for (const papel of ADMIN_ROLES) {
    it(`papel ${papel} sozinho ve so o conjunto esperado`, () => {
      expect(menuDe(linha([papel]))).toEqual(ESPERADO_POR_PAPEL[papel]);
    });
  }

  it('Auditor nao ve papeis, convites, acesso nem financeiro (CA-H103-05)', () => {
    const ids = menuDe(linha(['auditor']));
    expect(ids).not.toContain('equipe');
    expect(ids).not.toContain('acesso-aprovacao');
    expect(ids).not.toContain('financeiro');
  });

  it('Superadmin nao ve verificacao, moderacao, financeiro, suporte nem auditoria (menor privilegio, RF-145)', () => {
    const ids = menuDe(linha(['superadmin']));
    for (const proibida of ['verificacao', 'moderacao', 'financeiro', 'suporte', 'auditoria']) {
      expect(ids).not.toContain(proibida);
    }
  });

  it('a permissao vem do registro da conta: papel sem permissao efetiva nao ve nada', () => {
    expect(menuDe(linha(['auditor'], { permissions: [] }))).toEqual([]);
  });
});

describe('T-H103-02 uniao de papeis (CA-H103-07)', () => {
  it('suporte + auditor = uniao exata das duas telas e nenhuma outra', () => {
    expect(menuDe(linha(['suporte', 'auditor']))).toEqual(['acesso-excepcional', 'auditoria']);
  });

  it('superadmin + suporte = uniao das telas dos dois papeis', () => {
    expect(menuDe(linha(['superadmin', 'suporte']))).toEqual([
      'acesso-excepcional',
      'acesso-aprovacao',
      'operacao',
      'equipe',
      'catalogo',
    ]);
  });

  it('papel desconhecido nao concede nada: menu vazio', () => {
    expect(menuDe(linha(['papel-inexistente']))).toEqual([]);
  });

  it('o menu segue a ordem do catalogo, independente da ordem dos papeis', () => {
    const a = menuDe(linha(['auditor', 'suporte']));
    const b = menuDe(linha(['suporte', 'auditor']));
    expect(a).toEqual(b);
  });
});

describe('T-H103-03 tela sem rota registrada (CA-H103-11, D-H103-3)', () => {
  it('sem a rota de auditoria no registro, a trilha some para o Auditor', () => {
    const semAuditoria = ADMIN_ROUTES.filter((r) => r.pattern !== ADMIN_AUDIT_QUERY_PATH);
    expect(menuDe(linha(['auditor']), semAuditoria)).toEqual([]);
    expect(menuDe(linha(['auditor']))).toEqual(['auditoria']);
  });

  it('sem a rota de acesso excepcional, a tela some para o Suporte', () => {
    const semAcesso = ADMIN_ROUTES.filter((r) => r.pattern !== ADMIN_ACCESS_CASES_PATH);
    expect(menuDe(linha(['suporte']), semAcesso)).toEqual([]);
  });

  it('registro vazio: nenhuma tela aparece para nenhum papel', () => {
    for (const papel of ADMIN_ROLES) {
      expect(menuDe(linha([papel]), []), papel).toEqual([]);
    }
  });

  it('hoje so seis telas aparecem para algum papel (fixa o estado atual: H-103, painel H-108 e catalogo H-107)', () => {
    const todas = new Set(ADMIN_ROLES.flatMap((papel) => menuDe(linha([papel]))));
    expect([...todas].sort()).toEqual([
      'acesso-aprovacao',
      'acesso-excepcional',
      'auditoria',
      'catalogo',
      'equipe',
      'operacao',
    ]);
  });

  it('consoleMenuFor com permissao concedida mas sem rota no registro devolve vazio', () => {
    expect(consoleMenuFor(['audit.read'], [])).toEqual([]);
  });
});

describe('T-H103-04 coerencia com a guarda (R-2, CA-H103-10)', () => {
  it('cada tela com rota tem a mesma rota e a mesma permissao no registro', () => {
    for (const tela of ADMIN_CONSOLE_SCREENS) {
      if (tela.rota === null) continue;
      const rota = ADMIN_ROUTES.find(
        (r) => r.method === tela.rota?.method && r.pattern === tela.rota?.pattern,
      );
      expect(rota, tela.id).toBeDefined();
      expect(rota?.permission, tela.id).toBe(tela.permissao);
    }
  });

  it('ids unicos e nenhum id ou rotulo de chat, documento, e-mail ou promocao', () => {
    const ids = ADMIN_CONSOLE_SCREENS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const proibido = /chat|documento|identidade|e-?mail|promo|convers/i;
    for (const tela of ADMIN_CONSOLE_SCREENS) {
      expect(tela.id, tela.id).not.toMatch(proibido);
      expect(tela.rotulo, tela.id).not.toMatch(proibido);
    }
  });

  it('o menu da conta nunca cria rota: caminho e so da interface', () => {
    for (const papel of ADMIN_ROLES) {
      for (const item of consoleMenuFor(adminPermissionsOf([papel]), ADMIN_ROUTES)) {
        expect(item.caminho).toBe(`/console/${item.id}`);
      }
    }
  });
});

describe('T-H103-05 matriz de chamada direta (CA-H103-05, 08, 10, 12)', () => {
  it('papel x rota do registro: permissao concreta so passa com a permissao do papel; sessao passa com qualquer papel', () => {
    for (const papel of ADMIN_ROLES) {
      for (const rota of ADMIN_ROUTES) {
        const out = decideAdminGuard(linha([papel]), rota.permission, SYNTH_NOW);
        const rotulo = `${papel} ${rota.method} ${rota.pattern}`;
        if (rota.permission === 'publica') {
          expect(out.kind, rotulo).toBe('publica');
        } else if (rota.permission === 'sessao') {
          expect(out.kind, rotulo).toBe('autorizada');
        } else if (ADMIN_ROLE_PERMISSIONS[papel].includes(rota.permission)) {
          expect(out.kind, rotulo).toBe('autorizada');
        } else {
          expect(out.kind, rotulo).toBe('recusada');
          if (out.kind === 'recusada') {
            expect(out.response, rotulo).toBe(ADMIN_PERMISSION_DENIED);
            expect(out.response.body).toEqual({ code: 'permission_denied' });
          }
        }
      }
    }
  });

  it('Auditor: a unica rota de permissao concreta liberada e a consulta da trilha (CA-H103-05)', () => {
    const liberadas = ADMIN_ROUTES.filter(
      (r) =>
        r.permission !== 'sessao' &&
        r.permission !== 'publica' &&
        decideAdminGuard(linha(['auditor']), r.permission, SYNTH_NOW).kind === 'autorizada',
    ).map((r) => `${r.method} ${r.pattern}`);
    expect(liberadas).toEqual([`POST ${ADMIN_AUDIT_QUERY_PATH}`]);
  });

  it('Auditor: alteracao na trilha (PUT, PATCH, DELETE) nao tem rota (404)', () => {
    for (const metodo of ['PUT', 'PATCH', 'DELETE']) {
      expect(resolveAdminRoute(ADMIN_ROUTES, metodo, ADMIN_AUDIT_QUERY_PATH), metodo).toBeNull();
    }
  });

  it('chamada direta a rota de acesso por Auditor: 403 sem dado', () => {
    const rota = resolveAdminRoute(ADMIN_ROUTES, 'POST', ADMIN_ACCESS_CASES_PATH);
    expect(rota).not.toBeNull();
    const out = decideAdminGuard(linha(['auditor']), rota?.permission ?? 'sessao', SYNTH_NOW);
    expect(out).toEqual({ kind: 'recusada', response: ADMIN_PERMISSION_DENIED });
  });

  it('sem papel, sem aal2, conta inativa ou sessao vencida: 404 identico em toda rota (CA-H103-12)', () => {
    const casos: AdminGuardRecord[] = [
      linha(['superadmin'], { aal2: false }),
      linha(['superadmin'], { active: false }),
      linha(['superadmin'], { expiresAtMs: SYNTH_NOW - 1 }),
      linha([]),
    ];
    for (const row of casos) {
      for (const rota of ADMIN_ROUTES.filter((r) => r.permission !== 'publica')) {
        const out = decideAdminGuard(row, rota.permission, SYNTH_NOW);
        expect(out).toEqual({ kind: 'recusada', response: ADMIN_NOT_FOUND });
      }
    }
  });

  it('rota fora do registro (incluindo PUT na consulta da trilha) nao existe', () => {
    expect(resolveAdminRoute(ADMIN_ROUTES, 'GET', '/v1/admin/nada')).toBeNull();
    expect(resolveAdminRoute(ADMIN_ROUTES, 'PUT', ADMIN_AUDIT_QUERY_PATH)).toBeNull();
  });

  it('rota do menu e registrada com guarda sessao', () => {
    const rota = resolveAdminRoute(ADMIN_ROUTES, 'GET', '/v1/admin/console/menu');
    expect(rota?.permission).toBe('sessao');
  });
});

describe('T-H103-06 revogacao (CA-H103-09)', () => {
  it('papel revogado: a tela some e a rota e negada na requisicao seguinte', () => {
    const antes = handleConsoleMenu({ row: linha(['suporte']), registro: ADMIN_ROUTES }, SYNTH_NOW);
    expect((antes.body.telas as readonly Tela[]).map((t) => t.id)).toEqual(['acesso-excepcional']);

    // Requisicao seguinte: o banco ja nao devolve a sessao com o papel (guarda lida por requisicao).
    const depois = handleConsoleMenu({ row: null, registro: ADMIN_ROUTES }, SYNTH_NOW);
    expect(depois).toBe(ADMIN_NOT_FOUND);
    expect(decideAdminGuard(null, 'case.open_sensitive', SYNTH_NOW)).toEqual({
      kind: 'recusada',
      response: ADMIN_NOT_FOUND,
    });
  });

  it('conta sem nenhum papel ativo: menu 404 identico a sessao invalida', () => {
    expect(handleConsoleMenu({ row: linha([]), registro: ADMIN_ROUTES }, SYNTH_NOW)).toBe(ADMIN_NOT_FOUND);
  });
});

describe('T-H103-07 resposta do menu (CA-H103-10, R-5)', () => {
  it('200 com no-store e so id, rotulo e caminho em cada tela', () => {
    const out = handleConsoleMenu({ row: linha(['superadmin']), registro: ADMIN_ROUTES }, SYNTH_NOW);
    expect(out.status).toBe(200);
    expect(out.headers).toBe(ADMIN_HEADERS);
    expect(out.headers['Cache-Control']).toBe('no-store');
    expect(Object.keys(out.body)).toEqual(['telas']);
    for (const tela of out.body.telas as readonly Tela[]) {
      expect(Object.keys(tela).sort()).toEqual(['caminho', 'id', 'rotulo']);
    }
  });

  it('o corpo nao traz permissoes, papeis, e-mail nem dado de tela', () => {
    const out = handleConsoleMenu({ row: linha(['superadmin']), registro: ADMIN_ROUTES }, SYNTH_NOW);
    expect(JSON.stringify(out.body)).not.toMatch(/permiss|roles|e-?mail|userId|u-teste/i);
  });

  it('sem sessao ou sem aal2: 404 identico (mesmo objeto) a rota inexistente', () => {
    expect(handleConsoleMenu({ row: null, registro: ADMIN_ROUTES }, SYNTH_NOW)).toBe(ADMIN_NOT_FOUND);
    expect(
      handleConsoleMenu({ row: linha(['auditor'], { aal2: false }), registro: ADMIN_ROUTES }, SYNTH_NOW),
    ).toBe(ADMIN_NOT_FOUND);
  });
});
