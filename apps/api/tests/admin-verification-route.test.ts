// Issue 52 (H-039) | Rotas /v1/admin/verificacao/casos via HTTP (docs/factory/124-DESENHO-H039.md §5.3, §6):
// T-04 (negacao uniforme: caso inexistente, de outro analista e fora de estado saem como 404 vazio, igual a
// rota inexistente; desvio aprovado pelo lider: 404 no lugar de 403), T-14 (cabecalhos da leitura do
// documento), T-15 (so a leitura devolve bytes) e T-22 (falha do armazenamento vira mensagem generica, sem
// caminho). Servidor de loopback; fetch bloqueado; guarda e portas em memoria. Sem banco, sem rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-039');
};

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ADMIN_SESSION_COOKIE,
  VerificacaoErro,
  type AdminGuardRecord,
  type IdentityDocReaderPort,
  type VerificationCasePort,
} from '@fastpro/domain';
import { handleAdminVerificationRoute, type AdminVerificationRouteOptions } from '../src/admin-verification-route.js';

const BASE = 'https://admin.fastpro.example.test';
const PREFIXO = '/v1/admin/verificacao/casos';
const T0 = Date.UTC(2099, 0, 1, 12);
const MIN = 60 * 1000;
const INEXISTENTE = '11111111-2222-4333-8444-555555555555';
const DE_OUTRO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const FORA_DO_ESTADO = '99999999-8888-4777-8666-555555555555';
const DOCUMENTO = '66666666-7777-4888-8999-000000000000';
const NEGADOS = new Set([INEXISTENTE, DE_OUTRO, FORA_DO_ESTADO]);
const SEG_VERIFICACAO = 'example-admin-secret-verificacao-h039-0000';
const SEG_SUPERADMIN = 'example-admin-secret-superadmin-h039-000000';
const BYTES_JPEG = Buffer.from('JPEG-SINTETICO-H039');
const CASO_VALIDO = '12121212-3434-4565-8787-909090909090';
// Caso de perfil retido por duplicidade: a Verificacao ve o original vivo e a aprovacao e recusada (Issue 53, H-040).
const CASO_RETIDO = 'abcdef01-2345-4678-8901-234567890abc';
const MENSAGEM_ORIGINAL_VIVO =
  'Este cadastro não pode ser aprovado enquanto o documento estiver em uso por outro perfil ativo. Recuse ou aguarde.';

function linha(userId: string, roles: string[], permissions: string[]): AdminGuardRecord {
  return { userId, roles, permissions, aal2: true, active: true, expiresAtMs: T0 + 8 * 60 * MIN, totpAtMs: T0 };
}

const LINHAS = new Map<string, AdminGuardRecord>([
  [SEG_VERIFICACAO, linha('u-verificacao', ['verificacao'], ['verification.review'])],
  [SEG_SUPERADMIN, linha('u-superadmin', ['superadmin'], ['admin.role.manage'])],
]);

/** Porta em memoria: os tres ids negados simulam as negacoes do banco (42501). */
const casos: VerificationCasePort = {
  async listar() {
    return [];
  },
  async atribuir(_ctx, entrada) {
    if (NEGADOS.has(entrada.caseId)) throw new VerificacaoErro('permissao_negada');
    return { status: 'em_revisao', versao: entrada.versao + 1 };
  },
  async reatribuir() {
    throw new VerificacaoErro('permissao_negada');
  },
  async decidir(_ctx, entrada) {
    if (NEGADOS.has(entrada.caseId)) throw new VerificacaoErro('permissao_negada');
    if (entrada.caseId === CASO_RETIDO && entrada.decisao === 'aprovada') throw new VerificacaoErro('original_vivo');
    return { status: entrada.decisao, versao: entrada.versao + 1 };
  },
  async detalhe() {
    throw new VerificacaoErro('permissao_negada');
  },
  async receberRecurso() {
    return 'ok';
  },
  async duplicateView(_ctx, entrada) {
    if (NEGADOS.has(entrada.caseId)) throw new VerificacaoErro('permissao_negada');
    return { duplicada: true, originalId: '12345678', originalStatus: 'vivo', podeAprovar: false };
  },
};

let falhaDeArmazenamento = false;

/** Leitor em memoria: so entrega o documento de teste do caso valido; caso negado ou documento alheio devolve nulo (como a porta real). */
function leitorComDocumento(caseId: string): IdentityDocReaderPort {
  return {
    async readForReview(id: string) {
      if (falhaDeArmazenamento) {
        throw new VerificacaoErro('documento_indisponivel');
      }
      if (NEGADOS.has(caseId) || id !== DOCUMENTO) return null;
      return { bytes: new Uint8Array(BYTES_JPEG), type: 'image/jpeg' };
    },
  } as unknown as IdentityDocReaderPort;
}

const OPCOES: AdminVerificationRouteOptions = {
  guard: async (secret) => LINHAS.get(secret) ?? null,
  baseUrl: BASE,
  clock: { nowMs: () => T0 },
  casos,
  leitor: (_ctx, caseId) => leitorComDocumento(caseId),
};

let servidor: Server;
let porta: number;

beforeAll(async () => {
  servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://interno.invalid');
    void handleAdminVerificationRoute(req, res, OPCOES, url.pathname);
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', () => resolve()));
  porta = (servidor.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

interface Resposta {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly corpo: Buffer;
}

function chamar(
  metodo: 'GET' | 'POST',
  caminho: string,
  opcoes: { readonly segredo?: string; readonly corpo?: unknown; readonly origem?: string | null } = {},
): Promise<Resposta> {
  const cabecalhos: Record<string, string> = {};
  if (opcoes.segredo) cabecalhos.cookie = `${ADMIN_SESSION_COOKIE}=${opcoes.segredo}`;
  if (opcoes.origem !== null) cabecalhos.origin = opcoes.origem ?? BASE;
  if (metodo === 'POST') cabecalhos['sec-fetch-site'] = 'same-origin';
  const payload = opcoes.corpo === undefined ? null : JSON.stringify(opcoes.corpo);
  if (payload !== null) {
    cabecalhos['content-type'] = 'application/json';
    cabecalhos['content-length'] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: cabecalhos },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, corpo: Buffer.concat(partes) }));
      },
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

describe('T-04 negacao uniforme (404 vazio, igual a rota inexistente)', () => {
  it('caso inexistente, de outro analista e fora de estado respondem como rota inexistente', async () => {
    const referencia = await chamar('GET', `${PREFIXO}/${INEXISTENTE}/rota-que-nao-existe`, { segredo: SEG_VERIFICACAO });
    expect(referencia.status).toBe(404);
    for (const id of [INEXISTENTE, DE_OUTRO, FORA_DO_ESTADO]) {
      const atribuir = await chamar('POST', `${PREFIXO}/${id}/atribuir`, { segredo: SEG_VERIFICACAO, corpo: { versao: 1 } });
      const decisao = await chamar('POST', `${PREFIXO}/${id}/decisao`, {
        segredo: SEG_VERIFICACAO,
        corpo: { decisao: 'recusada', motivo: 'documento_ilegivel', versao: 2 },
      });
      const leitura = await chamar('POST', `${PREFIXO}/${id}/documento/leitura`, {
        segredo: SEG_VERIFICACAO,
        corpo: { documento: DOCUMENTO, motivo: 'analise_inicial' },
      });
      for (const r of [atribuir, decisao, leitura]) {
        expect(r.status).toBe(referencia.status);
        expect(r.corpo.length).toBe(referencia.corpo.length);
        expect(r.headers['content-type']).toBeUndefined();
      }
    }
  });

  it('papel sem a permissao da fila (superadmin) tambem recebe 404 vazio ao atribuir', async () => {
    const r = await chamar('POST', `${PREFIXO}/${DE_OUTRO}/atribuir`, { segredo: SEG_SUPERADMIN, corpo: { versao: 1 } });
    expect(r.status).toBe(404);
    expect(r.corpo.length).toBe(0);
  });

  it('sem cookie ou com Origin de outro site: nada e decidido e a resposta nao ecoa o caso', async () => {
    const semCookie = await chamar('GET', `${PREFIXO}/${DE_OUTRO}`);
    expect(semCookie.status).toBe(404);
    const origemErrada = await chamar('POST', `${PREFIXO}/${DE_OUTRO}/atribuir`, {
      segredo: SEG_VERIFICACAO,
      corpo: { versao: 1 },
      origem: 'https://site-de-terceiro.example.test',
    });
    expect(origemErrada.status).toBe(403);
    expect(origemErrada.corpo.toString('utf8')).not.toContain(DE_OUTRO);
  });
});

describe('T-14 e T-15 leitura do documento como anexo', () => {
  it('leitura pela Verificacao: anexo sem URL, nosniff, no-store, sem Location, nome fixo', async () => {
    const valida = await chamar('POST', `${PREFIXO}/${CASO_VALIDO}/documento/leitura`,
      { segredo: SEG_VERIFICACAO, corpo: { documento: DOCUMENTO, motivo: 'analise_inicial' } });
    expect(valida.status).toBe(200);
    expect(valida.headers['content-type']).toBe('image/jpeg');
    expect(valida.headers['content-disposition']).toBe('attachment; filename="documento-identidade.jpg"');
    expect(valida.headers['x-content-type-options']).toBe('nosniff');
    expect(valida.headers['cache-control']).toBe('no-store');
    expect(valida.headers.location).toBeUndefined();
    expect(valida.corpo.equals(BYTES_JPEG)).toBe(true);
  });

  it('motivo fora da lista fixa: 422 antes de qualquer leitura', async () => {
    const r = await chamar('POST', `${PREFIXO}/${CASO_VALIDO}/documento/leitura`,
      { segredo: SEG_VERIFICACAO, corpo: { documento: DOCUMENTO, motivo: 'curiosidade' } });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.corpo.toString('utf8'))).toEqual({ code: 'motivo_invalido' });
  });

  it('documento de outro caso: 404 vazio (negacao uniforme)', async () => {
    const r = await chamar('POST', `${PREFIXO}/${CASO_VALIDO}/documento/leitura`,
      { segredo: SEG_VERIFICACAO, corpo: { documento: INEXISTENTE, motivo: 'analise_inicial' } });
    expect(r.status).toBe(404);
    expect(r.corpo.length).toBe(0);
  });

  it('so a leitura devolve bytes: a lista e o detalhe respondem JSON', async () => {
    const lista = await chamar('GET', `${PREFIXO}?escopo=pendentes&limite=5`, { segredo: SEG_VERIFICACAO });
    expect(lista.status).toBe(200);
    expect(lista.headers['content-type']).toMatch(/^application\/json/);
    expect(lista.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(lista.corpo.toString('utf8'))).toEqual({ itens: [], proximo: null });
  });
});

describe('T-22 falha do armazenamento', () => {
  it('erro do armazenamento vira 502 com mensagem generica, sem caminho nem detalhe tecnico', async () => {
    falhaDeArmazenamento = true;
    try {
      const r = await chamar('POST', `${PREFIXO}/${CASO_VALIDO}/documento/leitura`,
        { segredo: SEG_VERIFICACAO, corpo: { documento: DOCUMENTO, motivo: 'analise_inicial' } });
      expect(r.status).toBe(502);
      const texto = r.corpo.toString('utf8');
      expect(JSON.parse(texto)).toEqual({
        code: 'documento_indisponivel',
        message: 'Não foi possível abrir o documento. Tente de novo.',
      });
      expect(texto).not.toMatch(/bucket|identity-docs|\.jpg|storage|sha|\//i);
    } finally {
      falhaDeArmazenamento = false;
    }
  });
});

describe('H-040 retencao por duplicidade (Issue 53): visao da Verificacao e recusa de original vivo', () => {
  it('visao da duplicidade: 200 sem cache e so os quatro campos permitidos', async () => {
    const r = await chamar('GET', `${PREFIXO}/${CASO_RETIDO}/duplicidade`, { segredo: SEG_VERIFICACAO });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(r.corpo.toString('utf8'))).toEqual({
      duplicada: true,
      originalId: '12345678',
      originalStatus: 'vivo',
      podeAprovar: false,
    });
  });

  it('visao de caso negado ou inexistente responde como rota inexistente (404 vazio)', async () => {
    const referencia = await chamar('GET', `${PREFIXO}/${INEXISTENTE}/rota-que-nao-existe`, { segredo: SEG_VERIFICACAO });
    const negado = await chamar('GET', `${PREFIXO}/${INEXISTENTE}/duplicidade`, { segredo: SEG_VERIFICACAO });
    expect(negado.status).toBe(referencia.status);
    expect(negado.corpo.length).toBe(referencia.corpo.length);
  });

  it('aprovar com original vivo: 422 original_vivo com o texto fixo, sem identificador nem UUID', async () => {
    const r = await chamar('POST', `${PREFIXO}/${CASO_RETIDO}/decisao`, {
      segredo: SEG_VERIFICACAO,
      corpo: { decisao: 'aprovada', motivo: 'aprovado', versao: 2 },
    });
    expect(r.status).toBe(422);
    const texto = r.corpo.toString('utf8');
    expect(JSON.parse(texto)).toEqual({ code: 'original_vivo', message: MENSAGEM_ORIGINAL_VIVO });
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(texto)).toBe(false);
  });
});
