// H-035 | Rotas PUT e GET /v1/professional/profile em memoria (docs/factory/75-DESENHO-H035.md §2, §3, §5;
// CA-01, CA-02, CA-03, CA-05, CA-07, CA-10, CA-11). Porta de perfil em memoria com as mesmas regras de
// duplicidade do banco (fora de recusada). Chaves sinteticas, sem banco e sem rede. Valores fictios.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-035');
};

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { hashSessionSecret } from '@fastpro/db';
import {
  SESSION_COOKIE_NAME,
  type SessionRecord,
  type SessionRepositoryPort,
} from '@fastpro/domain';
import { handleRequest } from '../src/app.js';
import {
  createProfessionalDocumentVault,
  type ProfessionalDocumentVault,
} from '../src/professional-document-crypto.js';
import type {
  NovoDocumentoProfissional,
  ProfessionalDocumentOutcome,
  ProfessionalProfilePort,
  ProfessionalProfileRecord,
  ProfessionalProfileRouteOptions,
  ProfessionalVerificationStatus,
} from '../src/professional-profile-route.js';

const SITE = 'https://fastpro.example.test';
const ROTA = '/v1/professional/profile';
const CPF_MASCARA = '529.982.247-25';
const CPF_DIGITOS = '52998224725';
const CNPJ = '11.222.333/0001-81';
const CNPJ_DIGITOS = '11222333000181';
const NOME = 'Ana Sintetica';

interface Linha {
  readonly userId: string;
  readonly emailVerified: boolean;
  publicName: string | null;
  slug: string | null;
  documentType: 'CPF' | 'CNPJ' | null;
  verificationStatus: ProfessionalVerificationStatus;
  hmac: string | null;
  enc: Buffer | null;
}

/** Porta em memoria: a mesma regra de duplicidade do banco (outro perfil com o HMAC, fora de recusada). */
class PerfisMemoria implements ProfessionalProfilePort {
  readonly linhas = new Map<string, Linha>();
  readonly gravacoes: NovoDocumentoProfissional[] = [];
  falhaGravar = false;

  cadastrar(userId: string, emailVerified = true): void {
    this.linhas.set(userId, {
      userId,
      emailVerified,
      publicName: null,
      slug: null,
      documentType: null,
      verificationStatus: 'pendente',
      hmac: null,
      enc: null,
    });
  }

  async find(userId: string): Promise<ProfessionalProfileRecord | null> {
    const l = this.linhas.get(userId);
    if (l === undefined) return null;
    return {
      emailVerified: l.emailVerified,
      publicName: l.publicName,
      slug: l.slug,
      documentType: l.documentType,
      verificationStatus: l.verificationStatus,
    };
  }

  async setDocument(novo: NovoDocumentoProfissional): Promise<ProfessionalDocumentOutcome> {
    if (this.falhaGravar) throw new Error('falha simulada de infraestrutura');
    this.gravacoes.push(novo);
    const linha = this.linhas.get(novo.userId);
    if (linha === undefined) throw new Error('perfil ausente');
    if (linha.documentType !== null) return 'ja_cadastrado';
    const outro = [...this.linhas.values()].some(
      (l) => l.userId !== novo.userId && l.hmac === novo.documentHmac && l.verificationStatus !== 'recusada',
    );
    linha.publicName = novo.publicName;
    linha.slug = novo.slug;
    linha.documentType = novo.documentType;
    linha.enc = novo.documentEnc;
    linha.hmac = novo.documentHmac;
    linha.verificationStatus = outro ? 'retida_duplicidade' : 'pendente';
    return outro ? 'retida_duplicidade' : 'pendente';
  }
}

interface Resposta {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly texto: string;
  readonly json: unknown;
  readonly ms: number;
}

interface Montagem {
  readonly opts: ProfessionalProfileRouteOptions;
  readonly perfis: PerfisMemoria;
  readonly vault: ProfessionalDocumentVault;
  readonly sessoes: Map<string, SessionRecord>;
  readonly cookieDe: (userId: string) => string;
}

function montar(floorMs = 0): Montagem {
  const perfis = new PerfisMemoria();
  const chaveDoc = randomBytes(32);
  const vault = createProfessionalDocumentVault({
    hmacKey: chaveDoc,
    activeVersion: 1,
    encKeys: new Map([[1, randomBytes(32)]]),
  });
  const sessoes = new Map<string, SessionRecord>();
  const repo = {
    authenticate: async (hash: string) => sessoes.get(hash) ?? null,
  } as unknown as SessionRepositoryPort;
  const cookieDe = (userId: string): string => {
    const segredo = randomBytes(32).toString('base64url');
    sessoes.set(hashSessionSecret(segredo), {
      sessionId: randomUUID(),
      userId,
      recentAuthAtMs: Date.now(),
      authMethod: 'password',
    });
    return `${SESSION_COOKIE_NAME}=${segredo}`;
  };
  const clock = { nowMs: () => Date.UTC(2099, 0, 1, 12) };
  return {
    opts: {
      sessions: repo,
      profiles: perfis,
      secrets: vault,
      siteUrl: SITE,
      clock,
      responseFloorMs: floorMs,
    },
    perfis,
    vault,
    sessoes,
    cookieDe,
  };
}

let servidor: Server;
let base: string;
let atual: Montagem;

function iniciar(m: Montagem): Promise<void> {
  atual = m;
  servidor = createServer((req, res) => {
    void handleRequest(req, res, {
      tickSecret: undefined,
      professionalProfile: m.opts,
    });
  });
  return new Promise((ok) => {
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      ok();
    });
  });
}

function chamar(
  metodo: 'PUT' | 'GET',
  caminho: string,
  opcoes: { cookie?: string; corpo?: unknown; texto?: string; origin?: string; contentType?: string } = {},
): Promise<Resposta> {
  const inicio = Date.now();
  const corpoTexto = opcoes.texto ?? (opcoes.corpo === undefined ? '' : JSON.stringify(opcoes.corpo));
  const headers: Record<string, string> = {
    origin: opcoes.origin ?? SITE,
    'sec-fetch-site': 'same-origin',
  };
  if (opcoes.cookie !== undefined) headers.cookie = opcoes.cookie;
  if (metodo === 'PUT') {
    headers['content-type'] = opcoes.contentType ?? 'application/json';
    headers['content-length'] = String(Buffer.byteLength(corpoTexto));
  }
  return new Promise((ok, falha) => {
    const req = request(`${base}${caminho}`, { method: metodo, headers }, (res) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json: unknown = undefined;
        try {
          json = texto === '' ? undefined : JSON.parse(texto);
        } catch {
          json = undefined;
        }
        ok({ status: res.statusCode ?? 0, headers: res.headers, texto, json, ms: Date.now() - inicio });
      });
    });
    req.on('error', falha);
    if (corpoTexto !== '') req.write(corpoTexto);
    req.end();
  });
}

const PUT = (cookie: string | undefined, corpo: unknown, extra: Parameters<typeof chamar>[2] = {}) =>
  chamar('PUT', ROTA, { cookie, corpo, ...extra });

function fechar(): Promise<void> {
  return new Promise((ok) => {
    servidor.closeAllConnections();
    servidor.close(() => ok());
  });
}

describe('T-H035-API PUT cadastro do documento (CA-01, CA-02, CA-04)', () => {
  beforeEach(async () => {
    await iniciar(montar());
  });
  afterEach(async () => {
    await fechar();
  });

  it('CPF com mascara: 201 com corpo fixo, linha em pendente, sem numero em claro', async () => {
    const userId = randomUUID();
    atual.perfis.cadastrar(userId);
    const r = await PUT(atual.cookieDe(userId), { publicName: NOME, documentType: 'CPF', document: CPF_MASCARA });
    expect(r.status).toBe(201);
    expect(r.texto).toBe('{"status":"received","verification":"pending"}');

    const linha = atual.perfis.linhas.get(userId)!;
    expect(linha.verificationStatus).toBe('pendente');
    expect(linha.documentType).toBe('CPF');
    expect(linha.hmac).toBe(atual.vault.hmac('CPF', CPF_DIGITOS));
    expect(linha.enc!.toString('latin1').includes(CPF_DIGITOS)).toBe(false);
    expect(atual.vault.open(userId, linha.enc!)).toBe(CPF_DIGITOS);
  });

  it('CNPJ: 201 e documentType CNPJ', async () => {
    const userId = randomUUID();
    atual.perfis.cadastrar(userId);
    const r = await PUT(atual.cookieDe(userId), { publicName: NOME, documentType: 'CNPJ', document: CNPJ });
    expect(r.status).toBe(201);
    expect(atual.perfis.linhas.get(userId)!.hmac).toBe(atual.vault.hmac('CNPJ', CNPJ_DIGITOS));
  });

  it('o HMAC de CPF com e sem mascara e igual (CA-04)', async () => {
    const a = randomUUID();
    const b = randomUUID();
    atual.perfis.cadastrar(a);
    atual.perfis.cadastrar(b);
    await PUT(atual.cookieDe(a), { publicName: NOME, documentType: 'CPF', document: CPF_MASCARA });
    await PUT(atual.cookieDe(b), { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS });
    expect(atual.perfis.linhas.get(a)!.hmac).toBe(atual.perfis.linhas.get(b)!.hmac);
  });
});

describe('T-H035-API duplicidade e reenvio (CA-05, CA-11)', () => {
  afterEach(async () => {
    await fechar();
  });

  it('duplicidade: mesmo corpo e mesmo tempo do sucesso; sem dados do outro perfil (CA-05, R3)', async () => {
    await iniciar(montar(200));
    const a = randomUUID();
    const b = randomUUID();
    atual.perfis.cadastrar(a);
    atual.perfis.cadastrar(b);
    const corpo = { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS };
    const sucesso = await PUT(atual.cookieDe(a), corpo);
    const dup = await PUT(atual.cookieDe(b), corpo);

    expect(sucesso.status).toBe(201);
    expect(dup.status).toBe(201);
    expect(dup.texto).toBe(sucesso.texto);
    expect(atual.perfis.linhas.get(b)!.verificationStatus).toBe('retida_duplicidade');
    expect(atual.perfis.linhas.get(a)!.verificationStatus).toBe('pendente');
    expect(dup.texto.includes(a)).toBe(false);
    expect(dup.texto.includes(NOME)).toBe(false);
    expect(sucesso.ms).toBeGreaterThanOrEqual(190);
    expect(dup.ms).toBeGreaterThanOrEqual(190);
  });

  it('reenvio do mesmo profissional: 200 ja_cadastrado e o documento nao muda (CA-11)', async () => {
    await iniciar(montar());
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const cookie = atual.cookieDe(a);
    await PUT(cookie, { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS });
    const antes = atual.perfis.linhas.get(a)!.hmac;
    const r = await PUT(cookie, { publicName: 'Outro Nome', documentType: 'CNPJ', document: CNPJ });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: 'ja_cadastrado' });
    expect(atual.perfis.linhas.get(a)!.hmac).toBe(antes);
    expect(atual.perfis.linhas.get(a)!.publicName).toBe(NOME);
    expect(atual.perfis.gravacoes).toHaveLength(1);
  });
});

describe('T-H035-API GET leitura sem dado sensivel (CA-10)', () => {
  beforeEach(async () => {
    await iniciar(montar());
  });
  afterEach(async () => {
    await fechar();
  });

  it('nunca devolve numero, document_enc nem document_hmac; traz so os campos publicos', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const cookie = atual.cookieDe(a);
    await PUT(cookie, { publicName: NOME, documentType: 'CPF', document: CPF_MASCARA });
    const r = await chamar('GET', ROTA, { cookie });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      publicName: NOME,
      slug: 'ana-sintetica',
      documentType: 'CPF',
      verification: 'pending',
    });
    for (const proibido of [CPF_DIGITOS, CPF_MASCARA, 'document_enc', 'document_hmac', atual.vault.hmac('CPF', CPF_DIGITOS)]) {
      expect(r.texto.includes(proibido)).toBe(false);
    }
  });

  it('sem documento ainda: 200 com nulos (estado vazio, CA-13)', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const r = await chamar('GET', ROTA, { cookie: atual.cookieDe(a) });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ publicName: null, slug: null, documentType: null, verification: null });
  });

  it('mapeia o estado publico: revisao e duplicidade viram pending; aprovada approved', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const linha = atual.perfis.linhas.get(a)!;
    linha.documentType = 'CPF';
    linha.publicName = NOME;
    linha.slug = 'ana';
    for (const [interno, publico] of [
      ['em_revisao', 'pending'],
      ['retida_duplicidade', 'pending'],
      ['aprovada', 'approved'],
      ['recusada', 'rejected'],
      ['suspensa', 'suspended'],
    ] as const) {
      linha.verificationStatus = interno;
      const r = await chamar('GET', ROTA, { cookie: atual.cookieDe(a) });
      expect((r.json as { verification: string }).verification).toBe(publico);
    }
  });

  it('GET sem sessao: 401', async () => {
    const r = await chamar('GET', ROTA);
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ code: 'nao_autenticado' });
  });
});

describe('T-H035-API erros de forma e de acesso (CA-03, RF-050)', () => {
  beforeEach(async () => {
    await iniciar(montar());
  });
  afterEach(async () => {
    await fechar();
  });

  it('CPF invalido: 422 por campo, sem eco do numero, sem gravacao', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const r = await PUT(atual.cookieDe(a), { publicName: NOME, documentType: 'CPF', document: '529.982.247-26' });
    expect(r.status).toBe(422);
    expect(r.json).toEqual({ code: 'invalid_field', fields: [{ field: 'document', reason: 'digito_verificador' }] });
    expect(r.texto.includes('529')).toBe(false);
    expect(atual.perfis.gravacoes).toHaveLength(0);
  });

  it('nome curto e tipo errado: 422 com dois campos', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const r = await PUT(atual.cookieDe(a), { publicName: 'A', documentType: 'RG', document: CPF_DIGITOS });
    expect(r.status).toBe(422);
    expect((r.json as { fields: unknown[] }).fields).toEqual([
      { field: 'publicName', reason: 'tamanho' },
      { field: 'documentType', reason: 'tipo_invalido' },
    ]);
  });

  it('sem cookie ou com sessao desconhecida: 401', async () => {
    const corpo = { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS };
    expect((await PUT(undefined, corpo)).status).toBe(401);
    const falso = `${SESSION_COOKIE_NAME}=${randomBytes(32).toString('base64url')}`;
    const r = await PUT(falso, corpo);
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ code: 'nao_autenticado' });
  });

  it('e-mail nao verificado: 403, sem gravacao (D3)', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a, false);
    const r = await PUT(atual.cookieDe(a), { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS });
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ code: 'email_nao_verificado' });
    expect(atual.perfis.gravacoes).toHaveLength(0);
  });

  it('conta sem perfil profissional: 403 nas duas rotas', async () => {
    const a = randomUUID();
    const cookie = atual.cookieDe(a);
    expect((await PUT(cookie, { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS })).status).toBe(403);
    expect((await chamar('GET', ROTA, { cookie })).status).toBe(403);
  });

  it('Origin de outro site: 403 antes de ler o corpo', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const r = await PUT(
      atual.cookieDe(a),
      { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS },
      { origin: 'https://outro.example.test' },
    );
    expect(r.status).toBe(403);
    expect(atual.perfis.gravacoes).toHaveLength(0);
  });

  it('formato e tamanho do corpo: 415 sem JSON, 400 JSON invalido, 413 acima de 4 KB', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const cookie = atual.cookieDe(a);
    expect((await PUT(cookie, undefined, { contentType: 'text/plain', texto: 'x' })).status).toBe(415);
    expect((await PUT(cookie, undefined, { texto: '{nao-json' })).status).toBe(400);
    const grande = { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS, extra: 'x'.repeat(5000) };
    expect((await PUT(cookie, grande)).status).toBe(413);
  });

  it('falha de gravacao: 503 sem o numero na resposta', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    atual.perfis.falhaGravar = true;
    const r = await PUT(atual.cookieDe(a), { publicName: NOME, documentType: 'CPF', document: CPF_DIGITOS });
    expect(r.status).toBe(503);
    expect(r.json).toEqual({ code: 'servico_indisponivel' });
    expect(r.texto.includes(CPF_DIGITOS)).toBe(false);
  });

  it('rota desconhecida com o mesmo caminho e metodo errado: 404', async () => {
    const r = await chamar('GET', '/v1/professional/outra');
    expect(r.status).toBe(404);
  });

  it('caminho com prefixo /api (mesma origem da web) chega a mesma rota', async () => {
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const r = await chamar('GET', `/api${ROTA}`, { cookie: atual.cookieDe(a) });
    expect(r.status).toBe(200);
  });
});

describe('T-H035-LOG nada do documento sai em log (CA-07, parcial)', () => {
  beforeEach(async () => {
    await iniciar(montar());
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fechar();
  });

  it('cadastro e erro nao escrevem nada no console', async () => {
    const espiões = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const a = randomUUID();
    atual.perfis.cadastrar(a);
    const cookie = atual.cookieDe(a);
    await PUT(cookie, { publicName: NOME, documentType: 'CPF', document: CPF_MASCARA });
    await PUT(cookie, { publicName: NOME, documentType: 'CPF', document: '529.982.247-26' });
    for (const espiao of espiões) expect(espiao).not.toHaveBeenCalled();
  });
});
