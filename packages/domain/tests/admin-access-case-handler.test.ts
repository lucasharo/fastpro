// H-073 (#83) | Manipuladores do caso de acesso excepcional (docs/factory/60-DESENHO-H073.md §1, §5):
// T-H073-05 (registro de rotas), T-H073-01 e T-H073-02 (abrir e aprovar pela porta), T-H073-03 (leitura
// com janela e gate), T-H073-04 (negacoes identicas byte a byte) e T-H073-06 (sem justificativa ou texto
// em resposta). Porta em memoria, relogio injetado, valores sinteticos. Sem rede e sem banco.
import { describe, it, expect } from 'vitest';
import {
  ADMIN_NOT_FOUND,
  ADMIN_PERMISSION_DENIED,
  ADMIN_ROUTES,
  handleAccessCaseApprove,
  handleAccessCaseClose,
  handleAccessCaseList,
  handleAccessCaseOpen,
  handleAccessCaseRead,
  ADMIN_ROUTES_H073,
  resolveAdminRoute,
  type AccessCaseDeps,
  type AccessCaseListItem,
  type AccessCasePort,
  type AccessCaseRequest,
  type AdminGuardRecord,
  type AdminRouteSpec,
} from '../src/admin/index.js';

const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const MIN = 60 * 1000;
const SENTINELA = 'SENTINELA-JUST-H073-HANDLER-zq';
const JUST = `${SENTINELA} motivo juridico detalhado`;
const CONV = '11111111-2222-4333-8444-555555555555';
const CASO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOVO = '99999999-8888-4777-8666-555555555555';
const SEGREDO = 'segredo-sintetico-h073';

const SUPERADMIN = ['admin.role.manage', 'catalog.manage', 'case.authorize_sensitive'];
const SUPORTE = ['support.completion.correct', 'case.open_sensitive'];
const AUDITOR = ['audit.read'];

function linha(userId: string, roles: string[], permissions: string[], totpAtMs = T0): AdminGuardRecord {
  return { userId, roles, permissions, aal2: true, active: true, expiresAtMs: T0 + 8 * 60 * MIN, totpAtMs };
}

function pedido(row: AdminGuardRecord | null, extra: Partial<AccessCaseRequest> = {}): AccessCaseRequest {
  return { row, secret: row === null ? null : SEGREDO, ...extra };
}

function erroBanco(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

/** Porta em memoria. Cada chamada e anotada; `falha` faz o metodo lancar o erro dado. */
function porta(falha: Partial<Record<'open' | 'approve' | 'close' | 'list', unknown>> = {}) {
  const chamadas: string[] = [];
  const argumentos: Record<string, unknown>[] = [];
  const lanca = (nome: string) => {
    if (falha[nome as keyof typeof falha] !== undefined) throw falha[nome as keyof typeof falha];
  };
  const port: AccessCasePort = {
    open: async (input) => {
      chamadas.push('open');
      argumentos.push({ ...input });
      lanca('open');
    },
    approve: async (input) => {
      chamadas.push('approve');
      argumentos.push({ ...input });
      lanca('approve');
      return { expiresAtMs: input.nowMs + 30 * MIN };
    },
    close: async (input) => {
      chamadas.push('close');
      argumentos.push({ ...input });
      lanca('close');
    },
    list: async (input) => {
      chamadas.push('list');
      argumentos.push({ ...input });
      lanca('list');
      const item: AccessCaseListItem & Record<string, unknown> = {
        id: CASO,
        estado: 'pendente',
        scope_id: CONV,
        justificativa: JUST,
        expires_at: null,
        participantes: ['pessoa-sintetica'],
        email: 'x@example.test',
      };
      return [item];
    },
  };
  return { port, chamadas, argumentos };
}

function deps(port: AccessCasePort, extra: Partial<AccessCaseDeps> = {}): AccessCaseDeps {
  return { cases: port, newCaseId: () => NOVO, ...extra };
}

describe('T-H073-05 registro de rotas', () => {
  it('cada rota do desenho declara a permissao certa e resolve no registro completo', () => {
    const esperado: [string, string, string][] = [
      ['POST', '/v1/admin/access-cases', 'case.open_sensitive'],
      ['GET', '/v1/admin/access-cases', 'sessao'],
      ['POST', `/v1/admin/access-cases/${CASO}/approve`, 'case.authorize_sensitive'],
      ['POST', `/v1/admin/access-cases/${CASO}/close`, 'sessao'],
      ['POST', `/v1/admin/access-cases/${CASO}/conversation/read`, 'case.open_sensitive'],
    ];
    for (const [metodo, caminho, permissao] of esperado) {
      const rota = resolveAdminRoute(ADMIN_ROUTES, metodo, caminho);
      expect(rota, `${metodo} ${caminho}`).not.toBeNull();
      expect(rota?.permission).toBe(permissao);
    }
    expect(ADMIN_ROUTES_H073).toHaveLength(5);
  });

  it('metodo, caminho ou id fora do desenho nao existe (404 no registro)', () => {
    const registro: readonly AdminRouteSpec[] = ADMIN_ROUTES;
    expect(resolveAdminRoute(registro, 'PUT', '/v1/admin/access-cases')).toBeNull();
    expect(resolveAdminRoute(registro, 'DELETE', `/v1/admin/access-cases/${CASO}`)).toBeNull();
    expect(resolveAdminRoute(registro, 'POST', '/v1/admin/access-cases/')).toBeNull();
    expect(resolveAdminRoute(registro, 'POST', `/v1/admin/access-cases/${CASO}/apagar`)).toBeNull();
  });
});

describe('T-H073-01 abrir caso', () => {
  const corpo = { conversation_id: CONV, justification: `  ${JUST}  ` };

  it('sem sessao: 404 identico ao de rota inexistente e nada chega ao banco', async () => {
    const { port, chamadas } = porta();
    const r = await handleAccessCaseOpen(pedido(null, { body: corpo }), deps(port), T0);
    expect(r).toEqual(ADMIN_NOT_FOUND);
    expect(chamadas).toEqual([]);
  });

  it('sem case.open_sensitive (auditor): 403 permission_denied, sem banco', async () => {
    const { port, chamadas } = porta();
    const row = linha('u-auditor', ['auditor'], AUDITOR);
    const r = await handleAccessCaseOpen(pedido(row, { body: corpo }), deps(port), T0);
    expect(r).toEqual(ADMIN_PERMISSION_DENIED);
    expect(chamadas).toEqual([]);
  });

  it('prova do segundo fator: 29:59 passa; 30:00 exige nova confirmacao (403 step_up_required)', async () => {
    const { port } = porta();
    const quase = linha('u-suporte', ['suporte'], SUPORTE, T0 - (30 * MIN - 1));
    const limite = linha('u-suporte', ['suporte'], SUPORTE, T0 - 30 * MIN);
    expect((await handleAccessCaseOpen(pedido(quase, { body: corpo }), deps(port), T0)).status).toBe(201);
    const r = await handleAccessCaseOpen(pedido(limite, { body: corpo }), deps(port), T0);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ code: 'step_up_required' });
  });

  it('conversa invalida ou justificativa fora de 20..500 (apos aparar): 422, sem banco', async () => {
    const { port, chamadas } = porta();
    const row = linha('u-suporte', ['suporte'], SUPORTE);
    const casos: unknown[] = [
      { conversation_id: 'nao-uuid', justification: JUST },
      { justification: JUST },
      { conversation_id: CONV, justification: 'a'.repeat(19) },
      { conversation_id: CONV, justification: '   ' + 'a'.repeat(19) + '   ' },
      { conversation_id: CONV, justification: 'a'.repeat(501) },
      { conversation_id: CONV, justification: 12345 },
    ];
    for (const body of casos) {
      const r = await handleAccessCaseOpen(pedido(row, { body }), deps(port), T0);
      expect(r.status).toBe(422);
    }
    expect(chamadas).toEqual([]);
  });

  it('pedido valido: 201 pendente; o banco recebe a justificativa aparada e nada e liberado', async () => {
    const { port, chamadas, argumentos } = porta();
    const row = linha('u-suporte', ['suporte'], SUPORTE);
    const r = await handleAccessCaseOpen(pedido(row, { body: corpo }), deps(port), T0);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: NOVO, status: 'pendente' });
    expect(chamadas).toEqual(['open']);
    expect(argumentos[0]?.justification).toBe(JUST);
    expect(JSON.stringify(r)).not.toContain(SENTINELA);
  });

  it('erros do banco viram respostas sem detalhe; mensagem desconhecida vira 503 sem sentinela', async () => {
    const row = linha('u-suporte', ['suporte'], SUPORTE);
    const casos: [unknown, number, string][] = [
      [erroBanco('ADM23', 'caso_ja_existe'), 409, 'caso_ja_existe'],
      [erroBanco('ADM24', 'muitos_casos_pendentes'), 429, 'muitos_casos_pendentes'],
      [erroBanco('ADM21', 'step_up_required'), 403, 'step_up_required'],
      [erroBanco('42501', 'permissao_negada'), 403, 'permission_denied'],
      [erroBanco('ADM22', 'conversa_invalida'), 422, 'conversa_invalida'],
      [erroBanco('XX000', `falha ${SENTINELA}`), 503, 'casos_indisponivel'],
    ];
    for (const [err, status, code] of casos) {
      const { port } = porta({ open: err });
      const r = await handleAccessCaseOpen(pedido(row, { body: { conversation_id: CONV, justification: JUST } }), deps(port), T0);
      expect(r.status).toBe(status);
      expect(r.body).toEqual({ code });
      expect(JSON.stringify(r)).not.toContain(SENTINELA);
    }
  });
});

describe('T-H073-02 aprovar caso (autorizacao por outra pessoa)', () => {
  const row = linha('u-superadmin', ['superadmin'], SUPERADMIN);

  it('sem case.authorize_sensitive (suporte): 403 permission_denied, sem banco', async () => {
    const { port, chamadas } = porta();
    const r = await handleAccessCaseApprove(pedido(linha('u-suporte', ['suporte'], SUPORTE), { caseId: CASO }), deps(port), T0);
    expect(r).toEqual(ADMIN_PERMISSION_DENIED);
    expect(chamadas).toEqual([]);
  });

  it('prova do segundo fator antiga: 403 step_up_required, sem banco', async () => {
    const { port, chamadas } = porta();
    const antiga = linha('u-superadmin', ['superadmin'], SUPERADMIN, T0 - 30 * MIN);
    const r = await handleAccessCaseApprove(pedido(antiga, { caseId: CASO }), deps(port), T0);
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ code: 'step_up_required' });
    expect(chamadas).toEqual([]);
  });

  it('id fora do formato: a mesma negacao de caso inexistente, sem banco', async () => {
    const { port, chamadas } = porta();
    const r = await handleAccessCaseApprove(pedido(row, { caseId: 'nao-uuid' }), deps(port), T0);
    expect(r).toEqual(ADMIN_PERMISSION_DENIED);
    expect(chamadas).toEqual([]);
  });

  it('aprovacao valida: 200 ativo, com vencimento = agora + 30 min (limite do desenho)', async () => {
    const { port, chamadas } = porta();
    const r = await handleAccessCaseApprove(pedido(row, { caseId: CASO }), deps(port), T0);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ativo', expires_at: new Date(T0 + 30 * MIN).toISOString() });
    expect(chamadas).toEqual(['approve']);
  });

  it('autoaprovacao, voto repetido, pedido nao pendente ou vencido: todos iguais a 403 permission_denied', async () => {
    const negacoes = [
      erroBanco('42501', 'aprovacao_propria'),
      erroBanco('23505', 'voto_repetido'),
      erroBanco('ADM25', 'caso_nao_pendente'),
      erroBanco('23514', 'aprovacao_nao_pendente'),
      erroBanco('23503', 'aprovacao_inexistente'),
      erroBanco('ADM09', 'aprovacao_nao_pendente'),
    ];
    const esperado = JSON.stringify(ADMIN_PERMISSION_DENIED);
    for (const err of negacoes) {
      const { port } = porta({ approve: err });
      const r = await handleAccessCaseApprove(pedido(row, { caseId: CASO }), deps(port), T0);
      expect(JSON.stringify(r)).toBe(esperado);
    }
  });
});

describe('fechar caso', () => {
  it('solicitante ou autorizador fecham: 200; sem sessao: 404', async () => {
    const { port, chamadas } = porta();
    const ok = await handleAccessCaseClose(pedido(linha('u-suporte', ['suporte'], SUPORTE), { caseId: CASO }), deps(port), T0);
    expect(ok.status).toBe(200);
    expect(chamadas).toEqual(['close']);
    const semSessao = await handleAccessCaseClose(pedido(null, { caseId: CASO }), deps(port), T0);
    expect(semSessao).toEqual(ADMIN_NOT_FOUND);
  });

  it('caso de outra pessoa sem vinculo: o banco nega (42501) e a resposta e 403 permission_denied', async () => {
    const { port } = porta({ close: erroBanco('42501', 'permissao_negada') });
    const r = await handleAccessCaseClose(pedido(linha('u-suporte', ['suporte'], SUPORTE), { caseId: CASO }), deps(port), T0);
    expect(r).toEqual(ADMIN_PERMISSION_DENIED);
  });
});

describe('listar casos (T-H073-02 visibilidade)', () => {
  it('so a projecao de 60 §1 sai; participantes e e-mail nunca; autorizador recebe canAuthorize', async () => {
    const { port, argumentos } = porta();
    const r = await handleAccessCaseList(pedido(linha('u-superadmin', ['superadmin'], SUPERADMIN), {}), deps(port), T0);
    expect(r.status).toBe(200);
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain('participantes');
    expect(texto).not.toContain('x@example.test');
    expect(argumentos[0]?.canAuthorize).toBe(true);
    expect(Object.keys((r.body.casos as Record<string, unknown>[])[0] ?? {}).sort()).toEqual(
      ['estado', 'expires_at', 'id', 'justificativa', 'scope_id'],
    );
  });

  it('suporte (sem autorizacao) lista com canAuthorize falso; falha do banco vira 503', async () => {
    const { port, argumentos } = porta();
    await handleAccessCaseList(pedido(linha('u-suporte', ['suporte'], SUPORTE), {}), deps(port), T0);
    expect(argumentos[0]?.canAuthorize).toBe(false);
    const falha = porta({ list: erroBanco('XX000', SENTINELA) });
    const r = await handleAccessCaseList(pedido(linha('u-suporte', ['suporte'], SUPORTE), {}), deps(falha.port), T0);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r)).not.toContain(SENTINELA);
  });
});

describe('T-H073-03 e T-H073-04 leitura pelo caso', () => {
  const suporte = linha('u-suporte', ['suporte'], SUPORTE);
  const leitorOk = {
    read: async () => ({ mensagens: [], tem_mais: false, proximo_cursor: null }),
  };

  it('sem leitor de conversa (H-065 ainda nao entregue): 501 leitura_indisponivel, depois da guarda', async () => {
    const { port } = porta();
    const r = await handleAccessCaseRead(pedido(suporte, { caseId: CASO }), deps(port), T0);
    expect(r.status).toBe(501);
    expect(r.body).toEqual({ code: 'leitura_indisponivel' });
    const auditor = await handleAccessCaseRead(pedido(linha('u-aud', ['auditor'], AUDITOR), { caseId: CASO }), deps(port), T0);
    expect(auditor).toEqual(ADMIN_PERMISSION_DENIED);
  });

  it('cursor fora de inteiro nao negativo: 422 paginacao_invalida, sem leitor', async () => {
    const { port } = porta();
    const leitor = { read: async () => { throw new Error('nao deveria ler'); } };
    for (const cursor of [-1, 1.5, 'x', Number.MAX_SAFE_INTEGER + 1]) {
      const r = await handleAccessCaseRead(pedido(suporte, { caseId: CASO, body: { cursor } }), deps(port, { conversation: leitor }), T0);
      expect(r.status).toBe(422);
      expect(r.body).toEqual({ code: 'paginacao_invalida' });
    }
  });

  it('gate negado no banco (ADM20, sem caso, vencido ou outra conversa): 403 permission_denied', async () => {
    const { port } = porta();
    const negado = { read: async () => { throw erroBanco('ADM20', 'acesso_negado'); } };
    const r = await handleAccessCaseRead(pedido(suporte, { caseId: CASO }), deps(port, { conversation: negado }), T0);
    expect(JSON.stringify(r)).toBe(JSON.stringify(ADMIN_PERMISSION_DENIED));
  });

  it('leitura liberada: repassa o cursor e devolve a pagina; id fora do formato e negacao de caso', async () => {
    const { port } = porta();
    let visto: unknown = 'nao-chamado';
    const leitor = { read: async (input: { cursor: number | null }) => { visto = input.cursor; return { mensagens: [], tem_mais: false, proximo_cursor: null }; } };
    const r = await handleAccessCaseRead(pedido(suporte, { caseId: CASO, body: { cursor: 0 } }), deps(port, { conversation: leitor }), T0);
    expect(r.status).toBe(200);
    expect(visto).toBe(0);
    const invalido = await handleAccessCaseRead(pedido(suporte, { caseId: 'nao-uuid' }), deps(port, { conversation: leitorOk }), T0);
    expect(invalido).toEqual(ADMIN_PERMISSION_DENIED);
  });
});

describe('T-H073-04 negacoes identicas e T-H073-06 sem sentinela nas respostas', () => {
  it('abrir sem permissao, aprovar sem permissao, ler sem caso e fechar de outro: mesmo corpo e cabecalhos', async () => {
    const { port } = porta({ close: erroBanco('42501') });
    const negados = [
      await handleAccessCaseOpen(pedido(linha('u-aud', ['auditor'], AUDITOR), { body: { conversation_id: CONV, justification: JUST } }), deps(port), T0),
      await handleAccessCaseApprove(pedido(linha('u-suporte', ['suporte'], SUPORTE), { caseId: CASO }), deps(port), T0),
      await handleAccessCaseClose(pedido(linha('u-suporte', ['suporte'], SUPORTE), { caseId: CASO }), deps(port), T0),
    ];
    const esperado = JSON.stringify(ADMIN_PERMISSION_DENIED);
    for (const r of negados) expect(JSON.stringify(r)).toBe(esperado);
  });

  it('nenhuma resposta de sucesso ou erro carrega a justificativa', async () => {
    const { port } = porta({ open: erroBanco('ADM23', 'caso_ja_existe') });
    const suporte = linha('u-suporte', ['suporte'], SUPORTE);
    const respostas = [
      await handleAccessCaseOpen(pedido(suporte, { body: { conversation_id: CONV, justification: JUST } }), deps(porta().port), T0),
      await handleAccessCaseOpen(pedido(suporte, { body: { conversation_id: CONV, justification: JUST } }), deps(port), T0),
    ];
    for (const r of respostas) expect(JSON.stringify(r)).not.toContain(SENTINELA);
  });
});
