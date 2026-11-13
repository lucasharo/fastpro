// H-037 (Issue #50, fase 2) | Montagem dos documentos de identidade (107-DESENHO-H037 §9, T-23).
// Cobre a trava, as pendencias com nomes (nunca valores), a montagem completa sem consultar banco nem Storage e a borda:
// fechada responde o mesmo 404 uniforme do rascunho; montada responde 401 sem cookie (a rota existe).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlClient } from '@fastpro/db';
import { siteOriginOf } from '@fastpro/domain';
import { handleRequest, type AppOptions } from '../src/app.js';
import { draftNotFound } from '../src/drafts/draft-service.js';
import {
  montarDocumentosDoAmbiente,
  pendenciasDocumentos,
} from '../src/identity-docs/identity-doc-montagem.js';
import { MemGate } from './identity-docs-fakes.js';

const COMPLETO: Record<string, string> = {
  IDENTITY_DOCS_ENABLED: '1',
  DATABASE_URL_APP_SYSTEM: 'postgres://app_system:senha-de-teste@localhost:5432/banco',
  SUPABASE_URL: 'https://projeto-de-teste.supabase.co',
  SUPABASE_SECRET_KEY: 'chave-de-servico-de-teste',
  DRAFT_IP_HMAC_KEY: 'k'.repeat(32),
  SITE_URL: 'https://fastpro.example',
};

function clienteFalso(): SqlClient {
  return { query: vi.fn(async () => ({ rows: [] })) } as unknown as SqlClient;
}

let servidor: Server | undefined;

afterEach(async () => {
  if (servidor) {
    await new Promise<void>((ok) => servidor!.close(() => ok()));
    servidor = undefined;
  }
});

async function subir(opcoes: AppOptions): Promise<string> {
  servidor = createServer((req, res) => {
    handleRequest(req, res, opcoes).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((ok) => servidor!.listen(0, '127.0.0.1', () => ok()));
  const { port } = servidor.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('H-037 | T-23: trava e pendencias da montagem', () => {
  it('fechada sem IDENTITY_DOCS_ENABLED=1: sem opcoes, sem pendencias e zero chamadas', () => {
    const abrir = vi.fn(() => clienteFalso());
    const r = montarDocumentosDoAmbiente({}, { abrirCliente: abrir, gate: new MemGate() });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([]);
    expect(abrir).not.toHaveBeenCalled();
  });

  it('valor da trava diferente de 1 continua fechada', () => {
    const r = montarDocumentosDoAmbiente({ ...COMPLETO, IDENTITY_DOCS_ENABLED: 'true' }, {
      abrirCliente: () => clienteFalso(),
      gate: new MemGate(),
    });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toEqual([]);
  });

  it('em producao sem IDENTITY_DOCS_L1_PARECER=1 fica fechada e nomeia a variavel', () => {
    const abrir = vi.fn(() => clienteFalso());
    const r = montarDocumentosDoAmbiente({ ...COMPLETO, VERCEL_ENV: 'production' }, { abrirCliente: abrir, gate: new MemGate() });
    expect(r.options).toBeUndefined();
    expect(r.pendencias).toContain('IDENTITY_DOCS_L1_PARECER');
    expect(abrir).not.toHaveBeenCalled();
  });

  it('aberta e incompleta lista so nomes, nunca valores', () => {
    const env = { ...COMPLETO, SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' };
    const pend = pendenciasDocumentos(env, {});
    expect(pend).toContain('SUPABASE_URL');
    expect(pend).toContain('SUPABASE_SECRET_KEY');
    expect(pend.some((p) => p.includes('senha-de-teste') || p.includes('chave-de-servico'))).toBe(false);
    const r = montarDocumentosDoAmbiente(env, {});
    expect(r.options).toBeUndefined();
    expect(JSON.stringify(r.pendencias)).not.toContain('senha-de-teste');
  });

  it('chave do IP curta e SITE_URL invalida viram pendencias com nome', () => {
    const pend = pendenciasDocumentos({ ...COMPLETO, DRAFT_IP_HMAC_KEY: 'curta', SITE_URL: 'nao-e-url' }, {});
    expect(pend).toContain('DRAFT_IP_HMAC_KEY (curta)');
    expect(pend).toContain('SITE_URL (invalida)');
  });

  it('aberta e completa monta as opcoes sem consultar banco nem Storage', () => {
    const cliente = clienteFalso();
    const abrir = vi.fn(() => cliente);
    const r = montarDocumentosDoAmbiente(COMPLETO, { abrirCliente: abrir, gate: new MemGate() });
    expect(r.pendencias).toEqual([]);
    expect(r.options).toBeDefined();
    expect(r.options?.siteUrl).toBe(siteOriginOf('https://fastpro.example'));
    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir).toHaveBeenCalledWith(COMPLETO.DATABASE_URL_APP_SYSTEM);
    expect(cliente.query).not.toHaveBeenCalled();
  });
});

describe('H-037 | T-23 na borda: 404 uniforme quando fechada e rota viva quando montada', () => {
  it('sem opcoes de documentos, GET /v1/professional/documents responde o 404 uniforme do rascunho', async () => {
    const base = await subir({ tickSecret: undefined });
    const r = await fetch(`${base}/v1/professional/documents`);
    const esperado = draftNotFound();
    expect(r.status).toBe(404);
    expect(await r.text()).toBe(String(esperado.body));
  });

  it('com a montagem completa, a rota existe: sem cookie responde 401', async () => {
    const montagem = montarDocumentosDoAmbiente(COMPLETO, { abrirCliente: () => clienteFalso(), gate: new MemGate() });
    expect(montagem.options).toBeDefined();
    const base = await subir({ tickSecret: undefined, identityDocs: montagem.options });
    const r = await fetch(`${base}/v1/professional/documents`);
    expect(r.status).toBe(401);
  });
});
