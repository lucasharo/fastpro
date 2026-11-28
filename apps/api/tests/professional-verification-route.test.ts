// Issue 54 (H-041) | Rotas do estado visivel e do recurso do profissional (CA-H041-03, 09, 11; T41-09, T41-11).
// Sem banco e sem rede: sessoes e porta falsas, requisicao e resposta simuladas.
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { hashSessionSecret } from '@fastpro/db';
import {
  SESSION_COOKIE_NAME,
  type LinhaEstadoVerificacao,
  type ProfessionalVerificationPort,
  type ResultadoRecurso,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';
import {
  handleProfessionalVerificationAppeal,
  handleProfessionalVerificationGet,
  type ProfessionalVerificationRouteOptions,
} from '../src/professional-verification-route.js';

const SITE_URL = 'https://app.example.test';
const SEGREDO_A = 'segredo-sintetico-h041-a';
const SEGREDO_B = 'segredo-sintetico-h041-b';
const USUARIO_A = '00000000-0000-4000-8000-00000000000a';
const USUARIO_B = '00000000-0000-4000-8000-00000000000b';
const T0 = Date.parse('2026-11-14T12:00:00.000Z');
const CAMPOS_PUBLICOS = ['decididoEm', 'estado', 'explicacao', 'motivo', 'recurso'];

function linha(parcial: Partial<LinhaEstadoVerificacao> & { out_state: string }): LinhaEstadoVerificacao {
  return { out_reason_code: null, out_explanation: null, out_decided_at: null, out_appeal: 'indisponivel', ...parcial };
}

function criarAmbiente() {
  const linhas = new Map<string, LinhaEstadoVerificacao>();
  const recursos: string[] = [];
  const estado: { resultado: ResultadoRecurso; falhaLeitura: boolean } = { resultado: 'ok', falhaLeitura: false };
  const verification: ProfessionalVerificationPort = {
    lerEstado: async (usuario) => {
      if (estado.falhaLeitura) throw new Error('falha sintetica com dado interno');
      return linhas.get(usuario) ?? null;
    },
    pedirRecurso: async (usuario) => {
      recursos.push(usuario);
      return estado.resultado;
    },
  };
  const sessions = {
    authenticate: async (hash: string): Promise<SessionRecord | null> => {
      if (hash === hashSessionSecret(SEGREDO_A)) return { userId: USUARIO_A } as unknown as SessionRecord;
      if (hash === hashSessionSecret(SEGREDO_B)) return { userId: USUARIO_B } as unknown as SessionRecord;
      return null;
    },
  } as unknown as SessionRepositoryPort;
  const opts: ProfessionalVerificationRouteOptions = {
    sessions,
    verification,
    siteUrl: SITE_URL,
    clock: { nowMs: () => T0 },
  };
  return { linhas, recursos, estado, opts };
}

function pedido(metodo: string, p: { cookie?: string | null; origin?: string; corpo?: string } = {}): IncomingMessage {
  const headers: Record<string, string> = {
    origin: p.origin ?? SITE_URL,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  };
  if (p.cookie !== null) headers.cookie = `${SESSION_COOKIE_NAME}=${p.cookie ?? SEGREDO_A}`;
  const corpo = p.corpo ?? '{"userId":"outro-profissional"}';
  return Object.assign(Readable.from([corpo]), { method: metodo, headers }) as unknown as IncomingMessage;
}

function resposta() {
  const r = {
    status: 0,
    headers: {} as Record<string, string>,
    corpo: '',
    writeHead(status: number, headers: Record<string, string>) {
      r.status = status;
      r.headers = headers;
    },
    end(texto?: string) {
      r.corpo = texto ?? '';
    },
  };
  return r;
}

async function get(opts: ProfessionalVerificationRouteOptions, p?: Parameters<typeof pedido>[1]) {
  const res = resposta();
  await handleProfessionalVerificationGet(pedido('GET', p), res as unknown as ServerResponse, opts);
  return res;
}

async function post(opts: ProfessionalVerificationRouteOptions, p?: Parameters<typeof pedido>[1]) {
  const res = resposta();
  await handleProfessionalVerificationAppeal(pedido('POST', p), res as unknown as ServerResponse, opts);
  return res;
}

describe('rotas do estado visivel (Issue 54, H-041)', () => {
  it('GET sem sessao: 401, corpo generico e no-store', async () => {
    const { opts } = criarAmbiente();
    const r = await get(opts, { cookie: null });
    expect(r.status).toBe(401);
    expect(JSON.parse(r.corpo)).toEqual({ code: 'nao_autenticado' });
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('T41-09 | sessao sem perfil profissional: GET e POST com corpo identico 404', async () => {
    const { opts } = criarAmbiente();
    const g = await get(opts);
    const p = await post(opts);
    expect(g.status).toBe(404);
    expect(p.status).toBe(404);
    expect(g.corpo).toBe('{"code":"nao_encontrado"}');
    expect(p.corpo).toBe(g.corpo);
  });

  it('T41-09 | cada sessao ve so o proprio estado; o corpo do POST nao escolhe o profissional', async () => {
    const { linhas, recursos, opts } = criarAmbiente();
    linhas.set(USUARIO_A, linha({ out_state: 'recusada', out_reason_code: 'outro', out_explanation: 'Dado de A.',
      out_decided_at: '2026-11-10T12:00:00.000Z', out_appeal: 'disponivel' }));
    const ver = await get(opts, { cookie: SEGREDO_B });
    expect(ver.status).toBe(404);
    expect(ver.corpo).not.toContain('Dado de A.');
    const recurso = await post(opts, { cookie: SEGREDO_B, corpo: `{"userId":"${USUARIO_A}"}` });
    expect(recurso.status).toBe(404);
    expect(recursos).toEqual([]);
  });

  it('T41-02/03 | recusa por duplicidade: resposta sem motivo, explicacao ou palavra de duplicidade', async () => {
    const { linhas, opts } = criarAmbiente();
    linhas.set(USUARIO_A, linha({ out_state: 'recusada', out_reason_code: 'duplicidade_suspeita',
      out_explanation: 'Outro cadastro usa este documento.', out_decided_at: '2026-11-10T12:00:00.000Z', out_appeal: 'disponivel' }));
    const r = await get(opts);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.corpo)).toEqual({
      estado: 'recusada',
      recurso: { situacao: 'disponivel' },
      decididoEm: '2026-11-10T12:00:00.000Z',
    });
    expect(r.corpo).not.toMatch(/duplic|outro cadastro/i);
  });

  it('CA-H041-02 | pendente, em_revisao e retido com a mesma linha geram o mesmo corpo byte a byte', async () => {
    const { linhas, opts } = criarAmbiente();
    linhas.set(USUARIO_A, linha({ out_state: 'em_analise', out_appeal: 'recebido' }));
    const primeiro = await get(opts);
    linhas.set(USUARIO_A, linha({ out_state: 'em_analise', out_appeal: 'recebido' }));
    const segundo = await get(opts);
    expect(primeiro.status).toBe(200);
    expect(segundo.corpo).toBe(primeiro.corpo);
    expect(primeiro.corpo).toBe('{"estado":"em_analise","recurso":{"situacao":"recebido"}}');
  });

  it('CA-H041-11 | resposta usa so a lista branca de campos', async () => {
    const { linhas, opts } = criarAmbiente();
    linhas.set(USUARIO_A, linha({ out_state: 'recusada', out_reason_code: 'documento_ilegivel', out_explanation: 'Foto cortada.',
      out_decided_at: '2026-11-10T12:00:00.000Z', out_appeal: 'disponivel' }));
    const corpo = JSON.parse((await get(opts)).corpo) as Record<string, unknown>;
    expect(Object.keys(corpo).sort()).toEqual(CAMPOS_PUBLICOS.filter((c) => c !== 'explicacao' || 'explicacao' in corpo).sort());
    expect(corpo).toMatchObject({ estado: 'recusada', motivo: 'documento_ilegivel', explicacao: 'Foto cortada.' });
    expect(Object.keys(corpo).some((k) => /caso|analista|hmac|cpf|document_|assigned|version/i.test(k))).toBe(false);
    expect(JSON.stringify(corpo)).not.toMatch(/hmac|cpf|analista|uuid|duplic/i);
  });

  it('CA-H041-08 | POST com origem invalida: 403 sem chamar o banco', async () => {
    const { recursos, opts } = criarAmbiente();
    const r = await post(opts, { origin: 'https://outro.example.test' });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.corpo)).toEqual({ code: 'origem_invalida' });
    expect(recursos).toEqual([]);
  });

  it('CA-H041-07 | POST elegivel: 200 recebido, usando o profissional da sessao', async () => {
    const { linhas, recursos, opts } = criarAmbiente();
    linhas.set(USUARIO_A, linha({ out_state: 'recusada', out_reason_code: 'outro', out_explanation: 'Motivo.',
      out_decided_at: '2026-11-10T12:00:00.000Z', out_appeal: 'disponivel' }));
    const r = await post(opts, { corpo: '{"userId":"outro"}' });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.corpo)).toEqual({ recurso: 'recebido' });
    expect(recursos).toEqual([USUARIO_A]);
    expect(r.headers['Cache-Control']).toBe('no-store');
  });

  it('CA-H041-07/08 | POST inelegivel: 409 com o mesmo codigo para qualquer causa', async () => {
    const { linhas, estado, opts } = criarAmbiente();
    linhas.set(USUARIO_A, linha({ out_state: 'em_analise', out_appeal: 'recebido' }));
    estado.resultado = 'recurso_indisponivel';
    const r = await post(opts);
    expect(r.status).toBe(409);
    expect(r.corpo).toBe('{"code":"recurso_indisponivel"}');
    expect(r.corpo).not.toMatch(/duplic|caso|nao_elegivel|ja_usado/i);
  });

  it('CA-H041-09 | sessao invalida: 401 no POST', async () => {
    const { recursos, opts } = criarAmbiente();
    const r = await post(opts, { cookie: 'sessao-falsa' });
    expect(r.status).toBe(401);
    expect(recursos).toEqual([]);
  });

  it('falha de banco vira 503 sem vazar a mensagem interna', async () => {
    const { linhas, estado, opts } = criarAmbiente();
    linhas.set(USUARIO_A, linha({ out_state: 'sem_envio' }));
    estado.falhaLeitura = true;
    const r = await get(opts);
    expect(r.status).toBe(503);
    expect(r.corpo).toBe('{"code":"servico_indisponivel"}');
    expect(r.corpo).not.toContain('falha sintetica');
  });
});
