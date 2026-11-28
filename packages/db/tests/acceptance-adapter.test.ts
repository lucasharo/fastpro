// H-058 (Issue #71) | Testes do adaptador do aceite com conexao falsa (162-DESENHO-H058.md, §7, fatia 4).
// Cobre T-H058-08 (replay), T-H058-10 (chave reutilizada), T-H058-34 (limite 20/min), T-H058-35 (55P03) na parte
// de ordem de transacao e mapa de erros. A concorrencia real no banco e a fatia 6.
import { describe, expect, it } from 'vitest';
import { ACCEPTANCE_RATE_LIMIT, PgAcceptanceRateLimit } from '../src/acceptance-rate-limit.js';
import {
  ACCEPTANCE_BANCO_INDISPONIVEL,
  PgAcceptanceStore,
  SQL_ACCEPTANCE_CREATE,
  SQL_ACCEPTANCE_READ,
  SQL_IDEMPOTENCY_BEGIN,
  SQL_IDEMPOTENCY_COMPLETE,
  type AcceptanceConnection,
} from '../src/acceptance.js';

const PROF = '11111111-2222-4333-8444-555555555555';
const REQ = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ACE = '99999999-8888-4777-8666-555555555555';
const CONV = '12345678-1234-4123-8123-123456789012';
const CHAVE = '5f0c6a1e-9d2b-4c3a-8e7f-1a2b3c4d5e6f';
const AGORA = new Date('2099-08-15T12:00:00.000Z');

type Resposta = { rows: unknown[] };
type Responder = (sql: string, params?: unknown[]) => Resposta | Promise<Resposta>;

function conexao(responder: Responder) {
  const sqls: string[] = [];
  const params: Array<unknown[] | undefined> = [];
  let liberada = 0;
  const conn: AcceptanceConnection & { sqls: string[]; params: Array<unknown[] | undefined>; liberada: () => number } = {
    query: async (sql: string, p?: unknown[]) => {
      sqls.push(sql);
      params.push(p);
      return responder(sql, p);
    },
    release: () => {
      liberada += 1;
    },
    sqls,
    params,
    liberada: () => liberada,
  };
  return conn;
}

const linhaCriada = (outcome = 'criado') => ({
  out_outcome: outcome,
  out_acceptance_id: ACE,
  out_request_id: REQ,
  out_slot_no: 1,
  out_wave: 1,
  out_status: 'ativo',
  out_accepted_at: AGORA,
  out_conversation_id: CONV,
  out_conversation_state: 'ativa',
  out_first_name: 'Ana',
});

function respostaPadrao(begin: Resposta, criacao?: Resposta): Responder {
  return (sql) => {
    if (sql === SQL_IDEMPOTENCY_BEGIN) return begin;
    if (sql === SQL_ACCEPTANCE_CREATE) return criacao ?? { rows: [linhaCriada()] };
    if (sql === SQL_IDEMPOTENCY_COMPLETE) return { rows: [{ ok: true }] };
    if (sql === SQL_ACCEPTANCE_READ) return { rows: [linhaCriada()] };
    return { rows: [] };
  };
}

const NOVA = { rows: [{ outcome: 'nova', response_status: null, response_body_ref: null }] };
const entrada = { requestId: REQ, professionalId: PROF, key: CHAVE, now: AGORA };

function storeCom(conn: AcceptanceConnection) {
  return new PgAcceptanceStore({ connect: async () => conn });
}

describe('PgAcceptanceStore | ordem da transacao', () => {
  it('criado: begin, lock_timeout 3 s, idempotencia, criacao, conclusao com 201 e commit; libera a conexao', async () => {
    const conn = conexao(respostaPadrao(NOVA));
    const r = await storeCom(conn).aceitar(entrada);
    expect(conn.sqls).toEqual([
      'begin',
      "set local lock_timeout = '3s'",
      SQL_IDEMPOTENCY_BEGIN,
      SQL_ACCEPTANCE_CREATE,
      SQL_IDEMPOTENCY_COMPLETE,
      'commit',
    ]);
    expect(conn.params[2]).toEqual([PROF, 'request_acceptance', CHAVE, expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(conn.params[3]).toEqual([REQ, PROF, AGORA.toISOString()]);
    expect(conn.params[4]).toEqual([PROF, 'request_acceptance', CHAVE, 201, `acceptance:${ACE}`]);
    expect(conn.liberada()).toBe(1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe(201);
      expect(r.envelope.acceptance).toEqual({
        id: ACE,
        requestId: REQ,
        slotNo: 1,
        wave: 1,
        status: 'ativo',
        acceptedAt: AGORA.toISOString(),
      });
      expect(r.envelope.conversation).toEqual({ id: CONV, state: 'ativa' });
      expect(r.envelope.customer).toEqual({ firstName: 'Ana' });
    }
  });

  it('existente: conclui com 200 e commit, sem nova linha', async () => {
    const conn = conexao(respostaPadrao(NOVA, { rows: [linhaCriada('existente')] }));
    const r = await storeCom(conn).aceitar(entrada);
    expect(conn.sqls).toContain(SQL_IDEMPOTENCY_COMPLETE);
    expect(conn.params[4]?.[3]).toBe(200);
    expect(r.ok && r.status).toBe(200);
  });
});

describe('PgAcceptanceStore | desfechos de idempotencia e de negocio', () => {
  it('T-H058-08 replay: chave concluida devolve 200 pelo id gravado, sem criar, com rollback', async () => {
    const conn = conexao(
      respostaPadrao({ rows: [{ outcome: 'repetida', response_status: 201, response_body_ref: `acceptance:${ACE}` }] }),
    );
    const r = await storeCom(conn).aceitar(entrada);
    expect(conn.sqls).not.toContain(SQL_ACCEPTANCE_CREATE);
    expect(conn.sqls).toContain(SQL_ACCEPTANCE_READ);
    expect(conn.sqls.indexOf('rollback')).toBeLessThan(conn.sqls.indexOf(SQL_ACCEPTANCE_READ));
    expect(r.ok && r.status).toBe(200);
    if (r.ok) expect(r.envelope.acceptance.id).toBe(ACE);
  });

  it('replay sem referencia valida devolve erro_interno (nunca inventa resposta)', async () => {
    const conn = conexao(respostaPadrao({ rows: [{ outcome: 'repetida', response_status: 201, response_body_ref: 'x' }] }));
    const r = await storeCom(conn).aceitar(entrada);
    expect(r).toEqual({ ok: false, status: 500, code: 'erro_interno' });
  });

  it('em_andamento: 409 operacao_em_andamento com Retry-After 1 s, com rollback', async () => {
    const conn = conexao(respostaPadrao({ rows: [{ outcome: 'em_andamento', response_status: null, response_body_ref: null }] }));
    const r = await storeCom(conn).aceitar(entrada);
    expect(r).toEqual({ ok: false, status: 409, code: 'operacao_em_andamento', retryAfterSeconds: 1 });
    expect(conn.sqls.at(-1)).toBe('rollback');
  });

  it('T-H058-10 conflito: 422 chave_reutilizada_com_corpo_diferente, sem criacao', async () => {
    const conn = conexao(respostaPadrao({ rows: [{ outcome: 'conflito', response_status: null, response_body_ref: null }] }));
    const r = await storeCom(conn).aceitar(entrada);
    expect(r).toEqual({ ok: false, status: 422, code: 'chave_reutilizada_com_corpo_diferente' });
    expect(conn.sqls).not.toContain(SQL_ACCEPTANCE_CREATE);
  });

  it('rejeicao de negocio (sem_vagas): rollback, sem conclusao da chave, 409 com mensagem neutra', async () => {
    const conn = conexao(respostaPadrao(NOVA, { rows: [{ ...linhaCriada('sem_vagas'), out_acceptance_id: null }] }));
    const r = await storeCom(conn).aceitar(entrada);
    expect(conn.sqls).not.toContain(SQL_IDEMPOTENCY_COMPLETE);
    expect(conn.sqls.at(-1)).toBe('rollback');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe('sem_vagas');
      expect(r.message).toBe('O pedido não está mais disponível para novos atendimentos.');
    }
  });

  it('servico_ou_raio_incompativel: 403 sem mensagem, sem escrita de chave', async () => {
    const conn = conexao(respostaPadrao(NOVA, { rows: [{ ...linhaCriada('servico_ou_raio_incompativel'), out_acceptance_id: null }] }));
    const r = await storeCom(conn).aceitar(entrada);
    expect(r).toEqual({ ok: false, status: 403, code: 'servico_ou_raio_incompativel' });
  });

  it('T-H058-35 55P03 no lock: 409 contencao_temporaria com Retry-After 1 s, com rollback', async () => {
    const conn = conexao((sql) => {
      if (sql === SQL_ACCEPTANCE_CREATE) throw Object.assign(new Error('lock_not_available'), { code: '55P03' });
      return respostaPadrao(NOVA)(sql);
    });
    const r = await storeCom(conn).aceitar(entrada);
    expect(r).toEqual({ ok: false, status: 409, code: 'contencao_temporaria', retryAfterSeconds: 1 });
    expect(conn.sqls.at(-1)).toBe('rollback');
    expect(conn.liberada()).toBe(1);
  });

  it('falha generica do banco: 503 servico_indisponivel sem texto do driver, com rollback', async () => {
    const conn = conexao((sql) => {
      if (sql === SQL_ACCEPTANCE_CREATE) throw new Error('conexao caiu: senha=segredo');
      return respostaPadrao(NOVA)(sql);
    });
    const r = await storeCom(conn).aceitar(entrada);
    expect(r).toEqual(ACCEPTANCE_BANCO_INDISPONIVEL);
    expect(JSON.stringify(r)).not.toMatch(/segredo|senha/);
    expect(conn.sqls.at(-1)).toBe('rollback');
  });
});

describe('PgAcceptanceRateLimit | limite de 20 por minuto (T-H058-34)', () => {
  it('passa ao banco o HMAC puro (sem prefixo, 64 hex) e a janela de 20 por minuto; devolve Retry-After limitado', async () => {
    const sqls: unknown[][] = [];
    const client = {
      query: async (sql: string, p?: unknown[]) => {
        sqls.push([sql, p]);
        if (sql.includes('rl_check')) return { rows: [{ out_ok: false, out_retry_after: 999999 }] };
        return { rows: [] };
      },
    };
    const rl = new PgAcceptanceRateLimit({ client, chaveDoProfissional: (id) => `hmac-${id.slice(0, 4)}` });
    const d = await rl.check(PROF, AGORA.getTime());
    expect(d).toEqual({ decision: 'barrado', retryAfterSeconds: expect.any(Number) });
    if (d.decision === 'barrado') expect(d.retryAfterSeconds).toBeLessThanOrEqual(86400);
    expect(sqls[0]?.[1]).toEqual([
      `hmac-1111`,
      ACCEPTANCE_RATE_LIMIT.spanSeconds,
      ACCEPTANCE_RATE_LIMIT.bucketSeconds,
      20,
      AGORA.toISOString(),
    ]);
    await rl.record(PROF, AGORA.getTime());
    expect(sqls[1]?.[1]).toEqual([`hmac-1111`, 60, AGORA.toISOString()]);
  });

  it('permitido quando o banco devolve out_ok verdadeiro', async () => {
    const client = { query: async () => ({ rows: [{ out_ok: true, out_retry_after: null }] }) };
    const rl = new PgAcceptanceRateLimit({ client, chaveDoProfissional: () => 'h' });
    expect(await rl.check(PROF, AGORA.getTime())).toEqual({ decision: 'permitido' });
  });
});
