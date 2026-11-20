// Issue 120 (H-111) | Testes das rotas do titular (147-DESENHO-H111 §5.1 e §7: T-API-01, T-API-02, T-API-03, T-API-06,
// T-API-07 e T-API-09 na parte de contrato). Sem banco e sem rede: sessao e porta SQL falsas. Nada e registrado.
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { SESSION_COOKIE_NAME } from '@fastpro/domain';
import { describe, expect, it } from 'vitest';
import {
  handlePrivacyTitularRoute,
  isPrivacyTitularRoute,
  privacyTitularRoute,
  validarCorpoAbertura,
  type PrivacyTitularRouteOptions,
} from './titular-route.js';
import { DsrTitularErro, ServicoDsrTitular, type DsrTitularSql } from './titular-service.js';

const SUJEITO = '11111111-1111-4111-8111-111111111111';
const CASO = '22222222-2222-4222-8222-222222222222';
const CHAVE = 'idem-chave-120-aaaa';
const TOKEN = 'token-stepup-sintetico-0123456789';

interface Resposta {
  status: number;
  corpo: unknown;
}

function erroBanco(mensagem: string, detalhe?: string, codigo = 'P0001'): Error {
  return Object.assign(new Error(mensagem), { detail: detalhe, code: codigo });
}

function sqlFalso(sobrescrita: Partial<DsrTitularSql> = {}): DsrTitularSql & { chamadas: Record<string, unknown[]> } {
  const chamadas: Record<string, unknown[]> = {};
  const registrar = (nome: string, valor: unknown) => {
    chamadas[nome] = [...(chamadas[nome] ?? []), valor];
  };
  const base: DsrTitularSql = {
    async abrir(e) {
      registrar('abrir', e);
      return { out_case_id: CASO, out_protocol: 'DSR-20261120-ABCDEF', out_status: 'aberto', out_deadline_at: '2026-12-05T00:00:00Z', out_deduplicated: false };
    },
    async listar(e) {
      registrar('listar', e);
      return [];
    },
    async obter() {
      return undefined;
    },
    async cancelar() {
      return { out_case_id: CASO, out_protocol: 'DSR-20261120-ABCDEF', out_status: 'cancelado', out_closed_at: '2026-11-20T10:00:00Z' };
    },
    ...sobrescrita,
  };
  return Object.assign(base, { chamadas });
}

function opcoes(sql: DsrTitularSql, sessaoValida = true): PrivacyTitularRouteOptions {
  return {
    sessions: { async authenticate() { return sessaoValida ? { userId: SUJEITO } : null; } },
    service: new ServicoDsrTitular(sql),
    relogio: { nowMs: () => Date.parse('2026-11-20T12:00:00Z') },
  };
}

async function chamar(
  metodo: string,
  url: string,
  opts: PrivacyTitularRouteOptions,
  { cookie = true, corpo, cabecalhos = {} }: { cookie?: boolean; corpo?: unknown; cabecalhos?: Record<string, string> } = {},
): Promise<Resposta> {
  const headers: Record<string, string> = { ...cabecalhos };
  if (cookie) headers.cookie = `${SESSION_COOKIE_NAME}=segredo-sintetico-120`;
  const texto = corpo === undefined ? '' : typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const req = Object.assign(Readable.from(texto === '' ? [] : [Buffer.from(texto, 'utf8')]), {
    method: metodo,
    url,
    headers,
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;
  const resposta: Resposta = { status: 0, corpo: undefined };
  let escrito = false;
  const res = {
    headersSent: false,
    writeHead(status: number) {
      resposta.status = status;
    },
    end(conteudo: string) {
      escrito = true;
      resposta.corpo = conteudo === '' ? undefined : JSON.parse(conteudo);
    },
  } as unknown as ServerResponse;
  await handlePrivacyTitularRoute(req, res, url.split('?')[0] ?? '', opts);
  expect(escrito).toBe(true);
  return resposta;
}

const CHAVE_OK = { 'idempotency-key': CHAVE };

describe('caminhos e corpo', () => {
  it('reconhece so o prefixo de direitos e interpreta colecao, detalhe e cancelamento', () => {
    expect(isPrivacyTitularRoute('/v1/privacy/dsr-requests')).toBe(true);
    expect(isPrivacyTitularRoute('/v1/privacy/dsr-requests/x/cancel')).toBe(true);
    expect(isPrivacyTitularRoute('/v1/privacy/other')).toBe(false);
    expect(privacyTitularRoute('/v1/privacy/dsr-requests')).toEqual({ acao: 'colecao' });
    expect(privacyTitularRoute(`/v1/privacy/dsr-requests/${CASO}`)).toEqual({ acao: 'detalhe', id: CASO });
    expect(privacyTitularRoute(`/v1/privacy/dsr-requests/${CASO}/cancel`)).toEqual({ acao: 'cancelar', id: CASO });
    expect(privacyTitularRoute('/v1/privacy/dsr-requests/a/b/c')).toBeNull();
  });

  it('aceita so as chaves do contrato e tipos corretos', () => {
    expect(validarCorpoAbertura({ kind: 'correcao', details: { x: 1 } })).toEqual({
      kind: 'correcao',
      detalhes: { x: 1 },
      stepUpToken: null,
    });
    expect(validarCorpoAbertura({ kind: 'acesso', sujeito: SUJEITO })).toBeNull();
    expect(validarCorpoAbertura({ kind: 'bloqueio' })).toBeNull();
    expect(validarCorpoAbertura({ kind: 'acesso', details: [] })).toBeNull();
    expect(validarCorpoAbertura({ kind: 'acesso', step_up_token: 'curto' })).toBeNull();
    expect(validarCorpoAbertura([])).toBeNull();
  });
});

describe('sessao e cabecalhos', () => {
  it('sem cookie ou com sessao invalida responde 401 sem tocar o banco', async () => {
    const sql = sqlFalso();
    expect((await chamar('GET', '/v1/privacy/dsr-requests', opcoes(sql), { cookie: false })).status).toBe(401);
    expect((await chamar('GET', '/v1/privacy/dsr-requests', opcoes(sql, false))).status).toBe(401);
    expect(sql.chamadas.listar).toBeUndefined();
  });

  it('metodo ou forma fora do contrato responde 404 uniforme', async () => {
    const sql = sqlFalso();
    expect(await chamar('PUT', '/v1/privacy/dsr-requests', opcoes(sql))).toEqual({ status: 404, corpo: { code: 'nao_encontrado' } });
    expect(await chamar('GET', `/v1/privacy/dsr-requests/${CASO}/cancel`, opcoes(sql))).toEqual({ status: 404, corpo: { code: 'nao_encontrado' } });
    expect(await chamar('GET', '/v1/privacy/dsr-requests/nao-e-uuid', opcoes(sql))).toEqual({ status: 404, corpo: { code: 'nao_encontrado' } });
  });
});

describe('abertura (POST /v1/privacy/dsr-requests)', () => {
  it('sem Idempotency-Key valida recusa com 422', async () => {
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sqlFalso()), { corpo: { kind: 'correcao' } });
    expect(r).toEqual({ status: 422, corpo: { code: 'chave_invalida' } });
  });

  it('acesso sem step-up responde 403 e nao chama o banco (T-API-02)', async () => {
    const sql = sqlFalso();
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sql), { corpo: { kind: 'acesso' }, cabecalhos: CHAVE_OK });
    expect(r).toEqual({ status: 403, corpo: { code: 'step_up_obrigatorio' } });
    expect(sql.chamadas.abrir).toBeUndefined();
  });

  it('corpo com chave extra recusa com 422 (contrato de chaves exatas)', async () => {
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sqlFalso()), {
      corpo: { kind: 'correcao', sujeito: SUJEITO },
      cabecalhos: CHAVE_OK,
    });
    expect(r).toEqual({ status: 422, corpo: { code: 'corpo_invalido' } });
  });

  it('acesso com step-up envia so o hash SHA-256 do token e responde 201 (T-API-01)', async () => {
    const sql = sqlFalso();
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sql), {
      corpo: { kind: 'acesso', step_up_token: TOKEN },
      cabecalhos: CHAVE_OK,
    });
    const esperado = createHash('sha256').update(TOKEN, 'utf8').digest('hex');
    const chamada = (sql.chamadas.abrir ?? [])[0] as { sujeito: string; stepUpHash: string; chave: string };
    expect(chamada.sujeito).toBe(SUJEITO);
    expect(chamada.stepUpHash).toBe(esperado);
    expect(JSON.stringify(sql.chamadas)).not.toContain(TOKEN);
    expect(chamada.chave).toBe(CHAVE);
    expect(r.status).toBe(201);
    expect(r.corpo).toEqual({
      id: CASO,
      protocol: 'DSR-20261120-ABCDEF',
      kind: 'acesso',
      status: 'aberto',
      deadline_at: '2026-12-05T00:00:00Z',
      deduplicated: false,
    });
  });

  it('repeticao com a mesma chave devolve 200 com deduplicated (desenho §4.1)', async () => {
    const sql = sqlFalso({
      async abrir() {
        return { out_case_id: CASO, out_protocol: 'DSR-20261120-ABCDEF', out_status: 'aberto', out_deadline_at: '2026-12-05T00:00:00Z', out_deduplicated: true };
      },
    });
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sql), { corpo: { kind: 'correcao' }, cabecalhos: CHAVE_OK });
    expect(r.status).toBe(200);
    expect((r.corpo as { deduplicated: boolean }).deduplicated).toBe(true);
  });

  it('caso ativo do mesmo tipo responde 409 com o protocolo do proprio titular (T-API-03)', async () => {
    const sql = sqlFalso({
      async abrir() {
        throw erroBanco('dsr_em_andamento', 'DSR-20261120-ABCDEF');
      },
    });
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sql), { corpo: { kind: 'correcao' }, cabecalhos: CHAVE_OK });
    expect(r).toEqual({ status: 409, corpo: { code: 'dsr_em_andamento', protocol: 'DSR-20261120-ABCDEF' } });
  });

  it('carencia de 30 dias responde 429 com a data de liberacao (decisao 682)', async () => {
    const sql = sqlFalso({
      async abrir() {
        throw erroBanco('dsr_carencia', '2026-12-20T00:00:00Z');
      },
    });
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sql), {
      corpo: { kind: 'acesso', step_up_token: TOKEN },
      cabecalhos: CHAVE_OK,
    });
    expect(r).toEqual({ status: 429, corpo: { code: 'dsr_carencia', carencia_ate: '2026-12-20T00:00:00Z' } });
  });

  it('falha desconhecida do banco vira 503 fixo, sem detalhe', async () => {
    const sql = sqlFalso({
      async abrir() {
        throw new Error('conexao caiu em 10.0.0.5 com senha de exemplo');
      },
    });
    const r = await chamar('POST', '/v1/privacy/dsr-requests', opcoes(sql), { corpo: { kind: 'correcao' }, cabecalhos: CHAVE_OK });
    expect(r).toEqual({ status: 503, corpo: { code: 'leitura_indisponivel' } });
  });
});

describe('leitura, lista e cancelamento', () => {
  it('lista com limit invalido responde 422 e cursor incompleto tambem', async () => {
    const sql = sqlFalso();
    expect((await chamar('GET', '/v1/privacy/dsr-requests?limit=0', opcoes(sql))).status).toBe(422);
    expect((await chamar('GET', '/v1/privacy/dsr-requests?cursor_id=' + CASO, opcoes(sql))).status).toBe(422);
  });

  it('lista devolve so os itens do titular e cursor quando a pagina esta cheia', async () => {
    const linha = (i: number) => ({
      out_case_id: `00000000-0000-4000-8000-00000000000${i}`,
      out_protocol: `DSR-20261120-AAAAA${i}`,
      out_kind: 'correcao',
      out_status: 'aberto',
      out_opened_at: `2026-11-2${i}T00:00:00Z`,
      out_deadline_at: '2026-12-05T00:00:00Z',
      out_closed_at: null,
      out_outcome: null,
    });
    const sql = sqlFalso({ async listar() { return [linha(1), linha(2)]; } });
    const r = await chamar('GET', '/v1/privacy/dsr-requests?limit=2', opcoes(sql));
    expect(r.status).toBe(200);
    const corpo = r.corpo as { itens: unknown[]; proximo_cursor: { id: string } | null };
    expect(corpo.itens).toHaveLength(2);
    expect(corpo.proximo_cursor?.id).toBe('00000000-0000-4000-8000-000000000002');
  });

  it('detalhe de caso alheio ou inexistente e identico ao de id inexistente (T-API-07)', async () => {
    const sql = sqlFalso();
    const r = await chamar('GET', `/v1/privacy/dsr-requests/${CASO}`, opcoes(sql));
    expect(r).toEqual({ status: 404, corpo: { code: 'nao_encontrado' } });
  });

  it('detalhe expõe fundamentacao so em indeferimento e nunca a nota interna', async () => {
    const base = {
      out_case_id: CASO,
      out_protocol: 'DSR-20261120-ABCDEF',
      out_kind: 'eliminacao',
      out_opened_at: '2026-11-20T00:00:00Z',
      out_deadline_at: '2026-12-05T00:00:00Z',
      out_closed_at: '2026-11-20T00:00:00Z',
      out_outcome: 'recusado_impedimento_legal',
      out_legal_basis_note: 'Retencao legal ativa.',
      out_timeline: [{ event: 'opened' }],
      out_extract_expires_at: null,
    };
    const indeferido = await chamar('GET', `/v1/privacy/dsr-requests/${CASO}`, opcoes(sqlFalso({ async obter() { return { ...base, out_status: 'indeferido_total' }; } })));
    expect((indeferido.corpo as { fundamentacao: string }).fundamentacao).toBe('Retencao legal ativa.');
    const aberto = await chamar('GET', `/v1/privacy/dsr-requests/${CASO}`, opcoes(sqlFalso({ async obter() { return { ...base, out_status: 'aberto', out_outcome: null }; } })));
    expect((aberto.corpo as { fundamentacao: unknown }).fundamentacao).toBeNull();
  });

  it('cancelamento fora de aberto responde 409 e cancelamento valido responde 200', async () => {
    const recusado = sqlFalso({
      async cancelar() {
        throw erroBanco('dsr_nao_cancelavel');
      },
    });
    const r1 = await chamar('POST', `/v1/privacy/dsr-requests/${CASO}/cancel`, opcoes(recusado), { cabecalhos: CHAVE_OK });
    expect(r1).toEqual({ status: 409, corpo: { code: 'dsr_nao_cancelavel' } });
    const ok = await chamar('POST', `/v1/privacy/dsr-requests/${CASO}/cancel`, opcoes(sqlFalso()), { cabecalhos: CHAVE_OK });
    expect(ok.status).toBe(200);
    expect((ok.corpo as { status: string }).status).toBe('cancelado');
  });

  it('erro de contrato vindo do servico e repassado com o status do desenho', () => {
    const e = new DsrTitularErro(403, { code: 'step_up_obrigatorio' });
    expect(e.status).toBe(403);
    expect(e.corpo).toEqual({ code: 'step_up_obrigatorio' });
  });
});
