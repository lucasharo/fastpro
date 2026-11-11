// H-104 (Issue 113) | Testes do dominio da consulta a auditoria (docs/factory/63-DESENHO-H104.md §5):
// T-H104-01 (validacao 422), T-H104-02 (404 e 403 sem chamar o banco), T-H104-04 (falha fecha, 503),
// T-H104-05 (sentinelas e lista fechada de campos), T-H104-06 (limite de 30 consultas em 5 min por admin,
// 429 muitas_consultas sem leitura e sem trilha; porta AuditQueryRateLimit, D-H104-9 / 63 R-2).
// T-H104-03 (matriz de rotas) depende da rota de producao, que nao e ligada nesta etapa: NAO coberto aqui.
// Sem rede, sem banco, relogio injetado.
import { describe, it, expect, vi } from 'vitest';
import {
  ADMIN_NOT_FOUND,
  ADMIN_PERMISSION_DENIED,
  ADMIN_QUERY_RATE_LIMITED,
  AUDIT_QUERY_EVENT_FIELDS,
  AUDIT_QUERY_MAX_MS,
  AUDIT_QUERY_RATE_LIMIT,
  AUDIT_QUERY_RATE_WINDOW_MS,
  handleAuditQuery,
  parseAuditQueryBody,
  type AdminGuardRecord,
  type AuditQueryPage,
  type AuditQueryPort,
  type AuditQueryRateLimit,
} from '../src/admin/index.js';

const T0 = Date.parse('2099-01-01T12:00:00.000Z');
const HORA = 60 * 60 * 1000;
const UUID = '6f1c2b7a-9d4e-4a3b-8c2d-1e0f9a8b7c6d';
const SENTINELA = 'SENTINELA-H104-EMAIL-ztq@example.test';

const corpo = (over: Record<string, unknown> = {}) => ({
  from: '2099-01-01T00:00:00Z',
  to: '2099-01-02T00:00:00Z',
  ...over,
});

const linhaAuditor = (over: Partial<AdminGuardRecord> = {}): AdminGuardRecord => ({
  userId: 'u-auditor-sintetico',
  roles: ['auditor'],
  permissions: ['audit.read'],
  aal2: true,
  active: true,
  expiresAtMs: T0 + 8 * HORA,
  totpAtMs: T0,
  ...over,
});

function portaFake(page?: Partial<AuditQueryPage>, erro?: unknown) {
  const query = vi.fn(async () => {
    if (erro !== undefined) throw erro;
    return {
      consulta_id: UUID,
      eventos: [],
      tem_mais: false,
      proximo_cursor: null,
      ...page,
    } satisfies AuditQueryPage;
  });
  return { query } as unknown as AuditQueryPort & { query: ReturnType<typeof vi.fn> };
}

interface RegistroLimite {
  readonly adminUserId: string;
  readonly atMs: number;
}

/** Limite em memoria: conta as consultas do admin com instante >= sinceMs (mesmo contrato da porta). */
function limitesFake(registros: readonly RegistroLimite[] = []) {
  const lista: RegistroLimite[] = [...registros];
  const counts = vi.fn(
    async (adminUserId: string, sinceMs: number) =>
      lista.filter((r) => r.adminUserId === adminUserId && r.atMs >= sinceMs).length,
  );
  const record = vi.fn(async (adminUserId: string, nowMs: number) => {
    lista.push({ adminUserId, atMs: nowMs });
  });
  const limits: AuditQueryRateLimit = { counts, record };
  return { limits, counts, record };
}

/** Dependencias do manipulador: porta de consulta falsa e limite em memoria (vazio por padrao). */
const dep = (port: AuditQueryPort, limits: AuditQueryRateLimit = limitesFake().limits) => ({
  query: port,
  limits,
});

describe('T-H104-01 validacao do corpo (422, sem eco do valor)', () => {
  it('corpo que nao e objeto e corpo_invalido', () => {
    const r = parseAuditQueryBody(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(422);
    if (!r.ok) expect(r.response.body).toEqual({ code: 'corpo_invalido', field: 'corpo' });
  });

  it('sem from ou sem to: periodo_invalido', () => {
    const semFrom = parseAuditQueryBody({ to: '2099-01-02T00:00:00Z' });
    const semTo = parseAuditQueryBody({ from: '2099-01-01T00:00:00Z' });
    expect(semFrom.ok).toBe(false);
    expect(semTo.ok).toBe(false);
    if (!semFrom.ok) expect(semFrom.response.body).toEqual({ code: 'periodo_invalido', field: 'from' });
    if (!semTo.ok) expect(semTo.response.body).toEqual({ code: 'periodo_invalido', field: 'to' });
  });

  it('instante sem fuso e recusado (ISO 8601 com Z ou offset)', () => {
    const r = parseAuditQueryBody(corpo({ from: '2099-01-01T00:00:00' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.body).toEqual({ code: 'periodo_invalido', field: 'from' });
  });

  it('from igual ou posterior a to: periodo_invalido', () => {
    const igual = parseAuditQueryBody(corpo({ to: '2099-01-01T00:00:00Z' }));
    const invertido = parseAuditQueryBody(corpo({ from: '2099-01-03T00:00:00Z' }));
    if (!igual.ok) expect(igual.response.body).toEqual({ code: 'periodo_invalido', field: 'to' });
    if (!invertido.ok) expect(invertido.response.body).toEqual({ code: 'periodo_invalido', field: 'to' });
    expect(igual.ok || invertido.ok).toBe(false);
  });

  it('exatamente 90 dias passa; 90 dias e 1 segundo: periodo_acima_do_teto', () => {
    const from = Date.parse('2099-01-01T00:00:00Z');
    const exato = parseAuditQueryBody(corpo({ to: new Date(from + AUDIT_QUERY_MAX_MS).toISOString() }));
    const acima = parseAuditQueryBody(corpo({ to: new Date(from + AUDIT_QUERY_MAX_MS + 1000).toISOString() }));
    expect(exato.ok).toBe(true);
    expect(acima.ok).toBe(false);
    if (!acima.ok) expect(acima.response.body).toEqual({ code: 'periodo_acima_do_teto', field: 'to' });
  });

  it('limit fora de 1..100 e paginacao_invalida; 1 e 100 passam; padrao 50', () => {
    expect(parseAuditQueryBody(corpo({ limit: 0 })).ok).toBe(false);
    expect(parseAuditQueryBody(corpo({ limit: 101 })).ok).toBe(false);
    const a = parseAuditQueryBody(corpo({ limit: 1 }));
    const b = parseAuditQueryBody(corpo({ limit: 100 }));
    const padrao = parseAuditQueryBody(corpo());
    expect(a.ok && b.ok && padrao.ok).toBe(true);
    if (padrao.ok) expect(padrao.query.limit).toBe(50);
    const z = parseAuditQueryBody(corpo({ limit: 0 }));
    if (!z.ok) expect(z.response.body).toEqual({ code: 'paginacao_invalida', field: 'limit' });
  });

  it('object_id sem object_type: filtro_invalido', () => {
    const r = parseAuditQueryBody(corpo({ object_id: UUID }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.body).toEqual({ code: 'filtro_invalido', field: 'object_id' });
    expect(parseAuditQueryBody(corpo({ object_type: 'review', object_id: UUID })).ok).toBe(true);
  });

  it('campo desconhecido e corpo_invalido, sem ecoar o nome nem o valor', () => {
    const r = parseAuditQueryBody(corpo({ texto_livre: SENTINELA }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.body).toEqual({ code: 'corpo_invalido', field: 'corpo' });
      expect(JSON.stringify(r.response.body)).not.toContain(SENTINELA);
    }
  });

  it('filtro com formato errado: filtro_invalido e o valor nao aparece na resposta', () => {
    const r = parseAuditQueryBody(corpo({ action: SENTINELA }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.body).toEqual({ code: 'filtro_invalido', field: 'action' });
      expect(JSON.stringify(r.response)).not.toContain(SENTINELA);
    }
  });
});

describe('T-H104-02 manipulador: 404 e 403 sem consultar o banco', () => {
  const agora = T0;

  it('sem sessao (linha nula) ou sem segredo: 404 identico ao de rota inexistente', async () => {
    const port = portaFake();
    const semLinha = await handleAuditQuery({ row: null, secret: 'segredo-sintetico', body: corpo() }, dep(port), agora);
    const semSegredo = await handleAuditQuery({ row: linhaAuditor(), secret: null, body: corpo() }, dep(port), agora);
    expect(semLinha).toEqual(ADMIN_NOT_FOUND);
    expect(semSegredo).toEqual(ADMIN_NOT_FOUND);
    expect(port.query).not.toHaveBeenCalled();
  });

  it('sessao vencida, sem aal2, conta inativa ou sem papel: 404', async () => {
    const port = portaFake();
    const casos = [
      linhaAuditor({ expiresAtMs: agora }),
      linhaAuditor({ aal2: false }),
      linhaAuditor({ active: false }),
      linhaAuditor({ roles: [] }),
    ];
    for (const row of casos) {
      const res = await handleAuditQuery({ row, secret: 's', body: corpo() }, dep(port), agora);
      expect(res).toEqual(ADMIN_NOT_FOUND);
    }
    expect(port.query).not.toHaveBeenCalled();
  });

  it('papel ativo sem audit.read (Financeiro, Superadmin): 403 permission_denied, sem consulta', async () => {
    const port = portaFake();
    const financeiro = linhaAuditor({ roles: ['financeiro'], permissions: ['case.open_sensitive'] });
    const superadmin = linhaAuditor({ roles: ['superadmin'], permissions: ['case.authorize_sensitive'] });
    expect(await handleAuditQuery({ row: financeiro, secret: 's', body: corpo() }, dep(port), agora)).toEqual(
      ADMIN_PERMISSION_DENIED,
    );
    expect(await handleAuditQuery({ row: superadmin, secret: 's', body: corpo() }, dep(port), agora)).toEqual(
      ADMIN_PERMISSION_DENIED,
    );
    expect(port.query).not.toHaveBeenCalled();
  });

  it('Auditor com corpo valido: 200 e a consulta recebe o ator e o segredo', async () => {
    const port = portaFake({ eventos: [] });
    const res = await handleAuditQuery(
      { row: linhaAuditor(), secret: 'segredo-sintetico', body: corpo() },
      dep(port),
      agora,
    );
    expect(res.status).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(port.query).toHaveBeenCalledTimes(1);
    const entrada = port.query.mock.calls[0]?.[0];
    expect(entrada).toMatchObject({ actorUserId: 'u-auditor-sintetico', secret: 'segredo-sintetico', limit: 50 });
  });

  it('negacao nunca chama o banco, mesmo com corpo invalido', async () => {
    const port = portaFake();
    await handleAuditQuery({ row: null, secret: 's', body: null }, dep(port), agora);
    expect(port.query).not.toHaveBeenCalled();
  });
});

describe('T-H104-04 falha fecha (503, sem dado, sem nova tentativa)', () => {
  const agora = T0;

  it('erro de auditoria (cadeia indisponivel) devolve 503 sem linhas e sem repetir a leitura', async () => {
    const port = portaFake(undefined, Object.assign(new Error('lock timeout'), { code: '55P03' }));
    const res = await handleAuditQuery({ row: linhaAuditor(), secret: 's', body: corpo() }, dep(port), agora);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'auditoria_indisponivel' });
    expect('eventos' in res.body).toBe(false);
    expect(port.query).toHaveBeenCalledTimes(1);
  });

  it('erros do banco mapeados: ADM30 vira 404, 42501 vira 403, ADM31 vira 422 com o codigo', async () => {
    const r404 = await handleAuditQuery(
      { row: linhaAuditor(), secret: 's', body: corpo() },
      dep(portaFake(undefined, Object.assign(new Error('sessao_invalida'), { code: 'ADM30' }))),
      agora,
    );
    const r403 = await handleAuditQuery(
      { row: linhaAuditor(), secret: 's', body: corpo() },
      dep(portaFake(undefined, Object.assign(new Error('permissao_negada'), { code: '42501' }))),
      agora,
    );
    const r422 = await handleAuditQuery(
      { row: linhaAuditor(), secret: 's', body: corpo() },
      dep(portaFake(undefined, Object.assign(new Error('filtro_invalido'), { code: 'ADM31' }))),
      agora,
    );
    expect(r404).toEqual(ADMIN_NOT_FOUND);
    expect(r403).toEqual(ADMIN_PERMISSION_DENIED);
    expect(r422.status).toBe(422);
    expect(r422.body).toEqual({ code: 'filtro_invalido' });
  });
});

describe('T-H104-05 sentinelas e lista fechada de campos (CA-H104-04)', () => {
  const agora = T0;
  const evento = (seq: number) => ({
    seq,
    id: `00000000-0000-4000-8000-00000000000${seq}`,
    at: '2099-01-01T01:00:00.000000Z',
    actor_ref: 'admin:u-x',
    actor_role: 'admin',
    action: 'payment.refunded',
    object_type: 'payment',
    object_id: UUID,
    before_state: { status: 'pago' },
    after_state: { status: 'estornado' },
    reason_code: 'estorno_ok',
    correlation_id: null,
    // Campos que o banco nunca deve devolver: a projecao precisa descarta-los.
    prev_hash: 'a'.repeat(64),
    row_hash: 'b'.repeat(64),
    email: SENTINELA,
  });

  it('cada evento sai com exatamente as 12 chaves da lista fechada e sem prev_hash, row_hash ou e-mail', async () => {
    const port = portaFake({ eventos: [evento(1), evento(2)], proximo_cursor: 2 });
    const res = await handleAuditQuery({ row: linhaAuditor(), secret: 's', body: corpo() }, dep(port), agora);
    expect(res.status).toBe(200);
    const eventos = (res.body as { eventos: Record<string, unknown>[] }).eventos;
    for (const e of eventos) {
      expect(Object.keys(e).sort()).toEqual([...AUDIT_QUERY_EVENT_FIELDS].sort());
    }
    const texto = JSON.stringify(res);
    expect(texto).not.toContain(SENTINELA);
    expect(texto).not.toContain('prev_hash');
    expect(texto).not.toContain('row_hash');
  });

  it('o 422 nao devolve o valor recebido em nenhum campo', () => {
    const valor = 'VALOR-SENTINELA-H104-' + 'x'.repeat(10);
    const r = parseAuditQueryBody(corpo({ object_type: valor }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.response)).not.toContain(valor);
  });
});

describe('T-H104-06 limite de consultas: 30 em 5 min por admin, 429 sem leitura e sem trilha (63 R-2)', () => {
  const agora = T0;
  const req = () => ({ row: linhaAuditor(), secret: 's', body: corpo() });

  it('a 31a consulta na janela recebe 429 muitas_consultas e o banco so foi chamado 30 vezes', async () => {
    const lim = limitesFake();
    const port = portaFake();
    for (let i = 0; i < AUDIT_QUERY_RATE_LIMIT; i++) {
      expect((await handleAuditQuery(req(), dep(port, lim.limits), agora)).status).toBe(200);
    }
    const recusada = await handleAuditQuery(req(), dep(port, lim.limits), agora);
    expect(recusada).toEqual(ADMIN_QUERY_RATE_LIMITED);
    expect(recusada.status).toBe(429);
    expect(recusada.body).toEqual({ code: 'muitas_consultas' });
    expect(port.query).toHaveBeenCalledTimes(AUDIT_QUERY_RATE_LIMIT);
    expect(lim.record).toHaveBeenCalledTimes(AUDIT_QUERY_RATE_LIMIT);
  });

  it('janela de 5 min: registro com 5 min e 1 ms nao conta; registro com exatos 5 min conta', async () => {
    const antigos = Array.from({ length: AUDIT_QUERY_RATE_LIMIT }, () => ({
      adminUserId: 'u-auditor-sintetico',
      atMs: agora - AUDIT_QUERY_RATE_WINDOW_MS - 1,
    }));
    const fora = await handleAuditQuery(req(), dep(portaFake(), limitesFake(antigos).limits), agora);
    expect(fora.status).toBe(200);

    const naBorda = antigos.map((r) => ({ ...r, atMs: agora - AUDIT_QUERY_RATE_WINDOW_MS }));
    const dentro = await handleAuditQuery(req(), dep(portaFake(), limitesFake(naBorda).limits), agora);
    expect(dentro.status).toBe(429);
  });

  it('o limite e por admin: outro Auditor com a mesma janela continua consultando', async () => {
    const cheio = Array.from({ length: AUDIT_QUERY_RATE_LIMIT }, () => ({
      adminUserId: 'u-auditor-sintetico',
      atMs: agora,
    }));
    const outro = linhaAuditor({ userId: 'u-auditor-b' });
    const res = await handleAuditQuery(
      { row: outro, secret: 's', body: corpo() },
      dep(portaFake(), limitesFake(cheio).limits),
      agora,
    );
    expect(res.status).toBe(200);
  });

  it('negacoes (404, 403) e 422 nao consomem vaga e nao registram no limite', async () => {
    const lim = limitesFake();
    const port = portaFake();
    await handleAuditQuery({ row: null, secret: 's', body: corpo() }, dep(port, lim.limits), agora);
    await handleAuditQuery(
      { row: linhaAuditor({ roles: ['financeiro'], permissions: ['case.open_sensitive'] }), secret: 's', body: corpo() },
      dep(port, lim.limits),
      agora,
    );
    await handleAuditQuery({ row: linhaAuditor(), secret: 's', body: corpo({ limit: 0 }) }, dep(port, lim.limits), agora);
    expect(lim.record).not.toHaveBeenCalled();
    expect(port.query).not.toHaveBeenCalled();
  });

  it('consulta aceita registra o admin e o instante antes da leitura', async () => {
    const lim = limitesFake();
    const port = portaFake();
    await handleAuditQuery(req(), dep(port, lim.limits), agora);
    expect(lim.record).toHaveBeenCalledWith('u-auditor-sintetico', agora);
    expect(port.query).toHaveBeenCalledTimes(1);
    const ordemRegistro = lim.record.mock.invocationCallOrder[0] ?? Number.NaN;
    const ordemLeitura = port.query.mock.invocationCallOrder[0] ?? Number.NaN;
    expect(ordemRegistro).toBeLessThan(ordemLeitura);
  });
});
