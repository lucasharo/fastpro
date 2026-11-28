// Issue 37 (H-024) | Campo `cobertura` so na resposta do dono: T-C09 (varredura: nenhuma rota e nenhuma resposta do
// profissional leva cobertura) e T-C10 (resposta do dono so booleana). Portas simuladas: sem banco, sem rede.
// Sentinelas e chaves montadas por concatenacao (check:secrets). Nenhum valor real de .env.local.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE_TEXTS_PROPOSTA,
  ELIGIBLE_PROFESSIONAL_KEYS,
  OWNER_KEYS,
  SESSION_COOKIE_NAME,
  type CoverageResult,
} from '@fastpro/domain';
import { hashSessionSecret, type OwnerRequestRow, type ProfessionalRequestRow, type SqlClient } from '@fastpro/db';
import { montarDetalhePedido } from '../src/requests/detail-composicao.js';
import { handleRequestDetailRoute, type RequestDetailRouteOptions } from '../src/requests/detail-route.js';
import {
  readRequestAsOwner,
  readRequestAsProfessional,
  type CoverageReaderPort,
  type DetailServiceDeps,
  type VisibilityStorePort,
} from '../src/requests/detail-service.js';
import { createAddressVault } from '../src/requests/address-crypto.js';

const DONO = '11111111-1111-4111-8111-111111111111';
const PRO = '44444444-4444-4444-8444-444444444444';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const SERVICO = '88888888-8888-4888-8888-888888888888';
const AGORA = Date.UTC(2026, 10, 14, 12, 0, 0);
const PRAZO = AGORA + 168 * 3600 * 1000;
const IP = ['10', '20', '30', '40'].join('.');
const HMAC_FALSO = 'f'.repeat(64);
const SEG_DONO = ['sessao', 'dono', 'issue37', '0000000000000000000000000000'].join('-');
const SEG_PRO = ['sessao', 'pro', 'issue37', '0000000000000000000000000000'].join('-');
const CHAVE_CIFRA = ['chave', 'cifra', 'issue37', 'em', 'memoria', '0123456789abcdef'].join('-');
const PEPPER = ['pepper', 'ip', 'issue37', '0123456789abcdef'].join('-');
const CHAVE_ENV = ['ADDRESS', 'ENC', 'KEY'].join('_');
const PEPPER_ENV = ['PEPPER', 'IP', 'HMAC'].join('_');
const URL_APP = 'postgres://app_system@localhost:5432/teste';
const ENDERECO = ['Rua', 'Sentinela', 'Issue', '37', '- SP'].join(' ');
const vault = createAddressVault(CHAVE_CIFRA);

function linhaDono(status = 'publicado', prazoMs = PRAZO): OwnerRequestRow {
  return {
    id: PEDIDO,
    status,
    serviceId: SERVICO,
    serviceName: 'Encanamento',
    urgency: 'alta',
    description: 'Vazamento embaixo da pia',
    firstName: 'Ana',
    addressEnc: vault.seal(ENDERECO, PEDIDO),
    addressTextLegado: null,
    publicLabel: 'Campinas - SP',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(prazoMs).toISOString(),
  };
}

function linhaProfissional(): ProfessionalRequestRow {
  return {
    id: PEDIDO,
    serviceId: SERVICO,
    serviceName: 'Encanamento',
    urgency: 'alta',
    description: 'Vazamento embaixo da pia',
    publicLabel: 'Campinas - SP',
    distanceKm: 1.5,
    modality: 'presencial',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(PRAZO).toISOString(),
  };
}

function lojaCom(dono: OwnerRequestRow | null, pro: ProfessionalRequestRow | null): VisibilityStorePort {
  return { readOwner: async () => dono, readProfessional: async () => pro };
}

interface Espiao {
  readonly chamadas: Array<{ requestId: string; customerId: string; ipKey: string; now: Date }>;
  readonly ips: string[];
}

function espiao(): Espiao {
  return { chamadas: [], ips: [] };
}

function portaCobertura(resultado: CoverageResult | Error, sonda: Espiao): CoverageReaderPort {
  return {
    async coverageFor(entrada) {
      sonda.chamadas.push(entrada);
      if (resultado instanceof Error) throw resultado;
      return resultado;
    },
    ipKey(ip) {
      sonda.ips.push(ip);
      return HMAC_FALSO;
    },
  };
}

function deps(store: VisibilityStorePort, cobertura?: CoverageReaderPort): DetailServiceDeps {
  return {
    store,
    addressVault: vault,
    clock: { nowMs: () => AGORA },
    ...(cobertura === undefined ? {} : { cobertura }),
  };
}

function opcoes(store: VisibilityStorePort, cobertura?: CoverageReaderPort): RequestDetailRouteOptions {
  return {
    sessions: {
      async authenticate(hash: string) {
        if (hash === hashSessionSecret(SEG_DONO)) return { userId: DONO };
        if (hash === hashSessionSecret(SEG_PRO)) return { userId: PRO };
        return null;
      },
    },
    service: deps(store, cobertura),
  };
}

function reqFalso(caminho: string, segredo: string, ip: string): IncomingMessage {
  return {
    method: 'GET',
    url: caminho,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${segredo}` },
    socket: { remoteAddress: ip },
  } as unknown as IncomingMessage;
}

async function get(caminho: string, segredo: string, opts: RequestDetailRouteOptions, ip = IP) {
  const capturado = { status: 0, texto: '' };
  let enviado = false;
  const res = {
    get headersSent() {
      return enviado;
    },
    writeHead(status: number) {
      capturado.status = status;
      enviado = true;
      return this;
    },
    end(texto?: string) {
      capturado.texto = texto ?? '';
      return this;
    },
  } as unknown as ServerResponse;
  await handleRequestDetailRoute(reqFalso(caminho, segredo, ip), res, caminho, opts);
  return {
    status: capturado.status,
    texto: capturado.texto,
    corpo: JSON.parse(capturado.texto) as Record<string, unknown>,
  };
}

function listarTs(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) saida.push(...listarTs(caminho));
    else if (entrada.name.endsWith('.ts')) saida.push(caminho);
  }
  return saida;
}

describe('T-C09: nenhuma rota nem resposta do profissional leva cobertura', () => {
  it('varredura estatica: todo arquivo de rota do profissional fica sem a palavra cobertura ou o servico de cobertura', () => {
    const raiz = fileURLToPath(new URL('../src', import.meta.url));
    const rotasProfissional = listarTs(raiz).filter((arquivo) => {
      const texto = readFileSync(arquivo, 'utf8');
      return texto.includes('/v1/professional') || texto.includes('/v1/pro/');
    });
    expect(rotasProfissional.length).toBeGreaterThan(0);
    for (const arquivo of rotasProfissional) {
      // O servico de leitura divide dono e profissional no mesmo arquivo: o trecho do profissional vai de
      // readRequestAsProfessional ate o fim (ele e a ultima funcao do arquivo).
      const texto = readFileSync(arquivo, 'utf8');
      const corte = texto.indexOf('export async function readRequestAsProfessional');
      const trechoProfissional = corte === -1 ? texto : texto.slice(corte);
      expect(trechoProfissional, arquivo).not.toMatch(/cobertura|coverage/);
    }
  });

  it('GET do profissional com pedido aberto e porta ligada: corpo sem cobertura e porta nunca chamada', async () => {
    const sonda = espiao();
    const r = await get(
      `/v1/professional/requests/${PEDIDO}`,
      SEG_PRO,
      opcoes(lojaCom(null, linhaProfissional()), portaCobertura('com', sonda)),
    );
    expect(r.status).toBe(200);
    expect(Object.keys(r.corpo)).toEqual([...ELIGIBLE_PROFESSIONAL_KEYS]);
    expect(r.texto).not.toContain('cobertura');
    expect(sonda.chamadas).toHaveLength(0);
  });

  it('leitura do profissional no servico: nenhuma chave de cobertura, mesmo com a porta na dependencia', async () => {
    const sonda = espiao();
    const r = await readRequestAsProfessional(PRO, PEDIDO, deps(lojaCom(null, linhaProfissional()), portaCobertura('sem', sonda)));
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(Object.keys(r.body)).not.toContain('cobertura');
    expect(sonda.chamadas).toHaveLength(0);
  });
});

describe('T-C10: a resposta do dono so traz o booleano (ou null)', () => {
  const casos: Array<[CoverageResult, boolean | null]> = [
    ['com', true],
    ['sem', false],
    ['limite', null],
    ['indisponivel', null],
  ];
  for (const [resultado, esperado] of casos) {
    it(`resultado ${resultado} vira ${esperado} e nada mais sai do banco`, async () => {
      const sonda = espiao();
      const r = await get(`/v1/requests/${PEDIDO}`, SEG_DONO, opcoes(lojaCom(linhaDono(), null), portaCobertura(resultado, sonda)));
      expect(r.status).toBe(200);
      expect(r.corpo.cobertura).toBe(esperado);
      expect(Object.keys(r.corpo)).toEqual([...OWNER_KEYS]);
      expect(r.texto).not.toContain(COVERAGE_TEXTS_PROPOSTA.true);
      expect(r.texto).not.toContain(COVERAGE_TEXTS_PROPOSTA.false);
    });
  }

  it('a consulta leva dono e pedido da sessao e o HMAC do IP, nunca o IP em claro', async () => {
    const sonda = espiao();
    await get(`/v1/requests/${PEDIDO}`, SEG_DONO, opcoes(lojaCom(linhaDono(), null), portaCobertura('com', sonda)));
    expect(sonda.ips).toEqual([IP]);
    expect(sonda.chamadas).toEqual([{ requestId: PEDIDO, customerId: DONO, ipKey: HMAC_FALSO, now: new Date(AGORA) }]);
    expect(JSON.stringify(sonda.chamadas)).not.toContain(IP);
  });

  it('falha da consulta vira null, sem texto do erro na resposta', async () => {
    const sonda = espiao();
    const r = await get(
      `/v1/requests/${PEDIDO}`,
      SEG_DONO,
      opcoes(lojaCom(linhaDono(), null), portaCobertura(new Error('falha sentinela de banco'), sonda)),
    );
    expect(r.status).toBe(200);
    expect(r.corpo.cobertura).toBeNull();
    expect(r.texto).not.toContain('falha sentinela');
  });

  it('sem porta (sem pepper de IP): pedido aberto sai com null, sem consulta', async () => {
    const r = await get(`/v1/requests/${PEDIDO}`, SEG_DONO, opcoes(lojaCom(linhaDono(), null)));
    expect(r.corpo.cobertura).toBeNull();
    expect(Object.keys(r.corpo)).toEqual([...OWNER_KEYS]);
  });

  const fechados: Array<[string, number]> = [
    ['selecionado', PRAZO],
    ['concluido', PRAZO],
    ['cancelado', PRAZO],
    ['publicado', AGORA],
  ];
  for (const [status, prazo] of fechados) {
    it(`pedido ${status} com prazo ${prazo === AGORA ? 'vencido' : 'vigente'}: o campo nao aparece e nao ha consulta`, async () => {
      const sonda = espiao();
      const r = await get(`/v1/requests/${PEDIDO}`, SEG_DONO, opcoes(lojaCom(linhaDono(status, prazo), null), portaCobertura('com', sonda)));
      expect(r.status).toBe(200);
      expect(r.corpo).not.toHaveProperty('cobertura');
      expect(sonda.chamadas).toHaveLength(0);
    });
  }

  it('servico: o dono recebe o campo; a chave nao aparece na leitura de pedido fechado', async () => {
    const sonda = espiao();
    const fechado = await readRequestAsOwner(DONO, PEDIDO, deps(lojaCom(linhaDono('cancelado'), null), portaCobertura('com', sonda)), IP);
    expect(fechado.status).toBe(200);
    if (fechado.status !== 200) return;
    expect(Object.keys(fechado.body)).not.toContain('cobertura');
    const aberto = await readRequestAsOwner(DONO, PEDIDO, deps(lojaCom(linhaDono(), null), portaCobertura('sem', sonda)), IP);
    expect(aberto.status === 200 && aberto.body.cobertura).toBe(false);
  });
});

describe('montagem: a porta de cobertura so existe com o pepper de IP', () => {
  const abrir = () => ({}) as unknown as SqlClient;

  it('com PEPPER_IP_HMAC: a chave do IP e HMAC de 64 hexadecimais e nao contem o IP', () => {
    const r = montarDetalhePedido(
      { DATABASE_URL_APP_SYSTEM: URL_APP, [CHAVE_ENV]: CHAVE_CIFRA, [PEPPER_ENV]: PEPPER },
      { abrirCliente: abrir, relogio: { nowMs: () => AGORA } },
    );
    const porta = r.options?.service.cobertura;
    expect(porta).toBeDefined();
    const chave = porta?.ipKey(IP) ?? '';
    expect(chave).toMatch(/^[0-9a-f]{64}$/);
    expect(chave).not.toContain(IP);
  });

  it('sem PEPPER_IP_HMAC: as rotas montam, mas a porta de cobertura fica ausente', () => {
    const r = montarDetalhePedido(
      { DATABASE_URL_APP_SYSTEM: URL_APP, [CHAVE_ENV]: CHAVE_CIFRA },
      { abrirCliente: abrir, relogio: { nowMs: () => AGORA } },
    );
    expect(r.pendencias).toEqual([]);
    expect(r.options).toBeDefined();
    expect(r.options?.service.cobertura).toBeUndefined();
  });
});
