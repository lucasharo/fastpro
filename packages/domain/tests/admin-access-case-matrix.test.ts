// H-073 (#83) | Matriz papel x rota do acesso excepcional (docs/factory/60-DESENHO-H073.md §1, §5, T-H073-05).
// Para cada papel de ADMIN_ROLES e cada rota de /v1/admin/access-cases e /v1/admin/session/step-up, a guarda
// de dominio (decideAdminGuard, o mesmo passo da API) decide: autorizada ou 403 permission_denied. Sem sessao,
// todas as rotas devolvem 404 identico. Sem rede e sem banco; valores sinteticos e relogio injetado.
import { describe, it, expect } from 'vitest';
import {
  ADMIN_ACCESS_CASES_PATH,
  ADMIN_NOT_FOUND,
  ADMIN_PERMISSION_DENIED,
  ADMIN_ROLES,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_ROUTES,
  ADMIN_STEP_UP_PATH,
  decideAdminGuard,
  resolveAdminRoute,
  type AdminGuardRecord,
  type AdminMethod,
  type AdminRole,
} from '../src/admin/index.js';

const AGORA = Date.UTC(2099, 0, 1, 12);
const CASO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CAMINHO_CASO = `${ADMIN_ACCESS_CASES_PATH}/${CASO}`;

/** Acoes do caso: metodo, caminho e o que o desenho permite a cada papel. */
const ACOES: readonly { readonly nome: string; readonly metodo: AdminMethod; readonly caminho: string }[] = [
  { nome: 'abrir', metodo: 'POST', caminho: ADMIN_ACCESS_CASES_PATH },
  { nome: 'listar', metodo: 'GET', caminho: ADMIN_ACCESS_CASES_PATH },
  { nome: 'aprovar', metodo: 'POST', caminho: `${CAMINHO_CASO}/approve` },
  { nome: 'fechar', metodo: 'POST', caminho: `${CAMINHO_CASO}/close` },
  { nome: 'ler', metodo: 'POST', caminho: `${CAMINHO_CASO}/conversation/read` },
];

/**
 * Esperado (60 §1, §3): abrir e ler so com case.open_sensitive; aprovar so com case.authorize_sensitive
 * (Superadmin, nunca o papel que abre); listar e fechar valem para qualquer sessao (o banco filtra o que cada
 * um ve: so os proprios casos, ou os pendentes de outros para quem autoriza).
 */
const ESPERADO: Readonly<Record<AdminRole, Readonly<Record<string, boolean>>>> = {
  superadmin: { abrir: false, listar: true, aprovar: true, fechar: true, ler: false },
  verificacao: { abrir: false, listar: true, aprovar: false, fechar: true, ler: false },
  moderador: { abrir: false, listar: true, aprovar: false, fechar: true, ler: false },
  financeiro: { abrir: false, listar: true, aprovar: false, fechar: true, ler: false },
  suporte: { abrir: true, listar: true, aprovar: false, fechar: true, ler: true },
  auditor: { abrir: false, listar: true, aprovar: false, fechar: true, ler: false },
  // H-109: papel de governanca de dados sem permissao de caso (82 §5).
  governanca_dados: { abrir: false, listar: true, aprovar: false, fechar: true, ler: false },
};

function linhaDo(papel: AdminRole): AdminGuardRecord {
  return {
    userId: `u-${papel}`,
    roles: [papel],
    permissions: [...ADMIN_ROLE_PERMISSIONS[papel]],
    aal2: true,
    active: true,
    expiresAtMs: AGORA + 8 * 60 * 60 * 1000,
    totpAtMs: AGORA,
  };
}

describe('T-H073-05 matriz papel x rota (registro completo)', () => {
  it('a tabela cobre todos os papeis do registro, sem papel faltando nem sobrando', () => {
    expect(Object.keys(ESPERADO).sort()).toEqual([...ADMIN_ROLES].sort());
  });

  it('cada papel e cada acao do caso segue o desenho (autorizada ou 403 permission_denied)', () => {
    for (const papel of ADMIN_ROLES) {
      for (const acao of ACOES) {
        const rota = resolveAdminRoute(ADMIN_ROUTES, acao.metodo, acao.caminho);
        expect(rota, `${papel} ${acao.nome}: rota existe`).not.toBeNull();
        const decisao = decideAdminGuard(linhaDo(papel), rota?.permission ?? 'publica', AGORA);
        const permitido = decisao.kind === 'autorizada';
        expect(permitido, `${papel} ${acao.nome}`).toBe(ESPERADO[papel][acao.nome]);
        if (!permitido) {
          expect(decisao.kind === 'recusada' ? decisao.response : null, `${papel} ${acao.nome}`).toEqual(
            ADMIN_PERMISSION_DENIED,
          );
        }
      }
    }
  });

  it('sem sessao valida, todas as rotas do caso e o step-up devolvem 404 identico (nunca 403)', () => {
    for (const acao of ACOES) {
      const rota = resolveAdminRoute(ADMIN_ROUTES, acao.metodo, acao.caminho);
      const decisao = decideAdminGuard(null, rota?.permission ?? 'publica', AGORA);
      expect(decisao.kind === 'recusada' ? decisao.response : null, acao.nome).toEqual(ADMIN_NOT_FOUND);
    }
    const stepUp = resolveAdminRoute(ADMIN_ROUTES, 'POST', ADMIN_STEP_UP_PATH);
    const semSessao = decideAdminGuard(null, stepUp?.permission ?? 'publica', AGORA);
    expect(semSessao.kind === 'recusada' ? semSessao.response : null).toEqual(ADMIN_NOT_FOUND);
  });

  it('o step-up de confirmacao recente vale para qualquer papel com sessao (60 §4)', () => {
    const stepUp = resolveAdminRoute(ADMIN_ROUTES, 'POST', ADMIN_STEP_UP_PATH);
    expect(stepUp?.permission).toBe('sessao');
    for (const papel of ADMIN_ROLES) {
      expect(decideAdminGuard(linhaDo(papel), 'sessao', AGORA).kind, papel).toBe('autorizada');
    }
  });

  it('nenhum papel ganha a permissao de outro: Superadmin nao abre, Suporte nao aprova (segregacao RF-145)', () => {
    expect(ADMIN_ROLE_PERMISSIONS.superadmin).not.toContain('case.open_sensitive');
    expect(ADMIN_ROLE_PERMISSIONS.suporte).not.toContain('case.authorize_sensitive');
    expect(ADMIN_ROLE_PERMISSIONS.auditor).not.toContain('case.open_sensitive');
    expect(ADMIN_ROLE_PERMISSIONS.auditor).not.toContain('case.authorize_sensitive');
  });
});
