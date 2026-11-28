// Issue 47 (H-034) | Servico da lista e montagem a partir do ambiente (docs/factory/133-DESENHO-H034.md, §6.1, §8).
// Cobre T-07 (paginacao na borda do servico), T-08 (lista vazia), T-14 (lista liga sem provedor de mapa ou
// geocodificacao) e T-17 (falha de banco). Sem banco real: a loja e falsa; o SQL real tem prova no dbtest da lista.
import { describe, expect, it, vi } from 'vitest';
import { PANEL_ITEM_KEYS, REQUEST_LIST_PAGE_SIZE, encodeListCursor, parseListCursor } from '@fastpro/domain';
import type { RequestListRow, RequestListStorePort, SqlClient } from '@fastpro/db';
import {
  CURSOR_INVALIDO_BODY,
  LISTA_INDISPONIVEL_BODY,
  listRequestsAsOwner,
  type RequestListServiceDeps,
} from '../src/requests/list-service.js';
import { montarListaPedidos } from '../src/requests/list-composicao.js';

const DONO = '11111111-1111-4111-8111-111111111111';
const AGORA = Date.UTC(2026, 10, 14, 12, 0, 0);
const SENT_ERRO = ['erro', 'driver', 'sentinela', 'h034', 'banco'].join(' ');

function uuidDe(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
}

function linha(i: number): RequestListRow {
  const segundos = String(i % 60).padStart(2, '0');
  return {
    id: uuidDe(i),
    serviceName: 'Encanamento',
    status: 'publicado',
    prazo: 'aberto',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(AGORA + 168 * 3600 * 1000).toISOString(),
    cursorTs: `2026-11-14T12:00:${segundos}.000001Z`,
  };
}

class LojaFalsa implements RequestListStorePort {
  chamadas: Array<{ cursor: unknown; limit: number }> = [];
  linhas: RequestListRow[] = [];
  erro: Error | null = null;

  async listOwner(_userId: string, _nowMs: number, cursor: unknown, limit: number): Promise<readonly RequestListRow[]> {
    this.chamadas.push({ cursor, limit });
    if (this.erro !== null) throw this.erro;
    return this.linhas.slice(0, limit);
  }
}

function deps(loja: LojaFalsa): RequestListServiceDeps {
  return { store: loja, clock: { nowMs: () => AGORA } };
}

describe('servico da lista (T-07, T-08, T-17)', () => {
  it('lista vazia devolve items vazio e nextCursor nulo', async () => {
    const loja = new LojaFalsa();
    const r = await listRequestsAsOwner(DONO, null, deps(loja));
    expect(r).toEqual({ status: 200, body: { items: [], nextCursor: null } });
  });

  it('21 linhas: mostra 20 e devolve nextCursor com o cursor da 20a linha; busca uma a mais', async () => {
    const loja = new LojaFalsa();
    loja.linhas = Array.from({ length: 21 }, (_, i) => linha(i + 1));
    const r = await listRequestsAsOwner(DONO, null, deps(loja));
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(r.body.items).toHaveLength(REQUEST_LIST_PAGE_SIZE);
    expect(loja.chamadas[0]).toEqual({ cursor: null, limit: REQUEST_LIST_PAGE_SIZE + 1 });
    const decodificado = parseListCursor(r.body.nextCursor ?? '');
    expect(decodificado).toEqual({ publishedAt: linha(20).cursorTs, id: uuidDe(20) });
  });

  it('ultima pagina (sem linha extra) devolve nextCursor nulo', async () => {
    const loja = new LojaFalsa();
    loja.linhas = Array.from({ length: 5 }, (_, i) => linha(i + 1));
    const r = await listRequestsAsOwner(DONO, null, deps(loja));
    expect(r.status === 200 && r.body.nextCursor).toBeNull();
  });

  it('cursor valido e repassado ao banco como ts e id; o item tem so as chaves fechadas, na ordem', async () => {
    const loja = new LojaFalsa();
    loja.linhas = [linha(3)];
    const cursor = encodeListCursor({ publishedAt: linha(9).cursorTs, id: uuidDe(9) });
    const r = await listRequestsAsOwner(DONO, cursor, deps(loja));
    expect(loja.chamadas[0]?.cursor).toEqual({ publishedAt: linha(9).cursorTs, id: uuidDe(9) });
    if (r.status !== 200) throw new Error('esperado 200');
    expect(Object.keys(r.body.items[0] ?? {})).toEqual([...PANEL_ITEM_KEYS]);
  });

  it('cursor recusado nao chega ao banco e responde 400 com codigo fixo', async () => {
    const loja = new LojaFalsa();
    const r = await listRequestsAsOwner(DONO, 'nao-e-cursor', deps(loja));
    expect(r).toEqual({ status: 400, body: CURSOR_INVALIDO_BODY });
    expect(loja.chamadas).toHaveLength(0);
  });

  it('falha do banco vira 503 com corpo fixo, sem texto do driver', async () => {
    const loja = new LojaFalsa();
    loja.erro = new Error(SENT_ERRO);
    const r = await listRequestsAsOwner(DONO, null, deps(loja));
    expect(r).toEqual({ status: 503, body: LISTA_INDISPONIVEL_BODY });
    expect(JSON.stringify(r)).not.toContain(SENT_ERRO);
  });
});

describe('montagem da lista a partir do ambiente (T-14)', () => {
  const cliente = { query: vi.fn(async () => ({ rows: [] })) } as unknown as SqlClient;

  it('sem DATABASE_URL_APP_SYSTEM a lista nao liga e aponta o nome da variavel (sem valor)', () => {
    const m = montarListaPedidos({}, { abrirCliente: () => cliente });
    expect(m.options).toBeUndefined();
    expect(m.pendencias).toContain('DATABASE_URL_APP_SYSTEM');
  });

  it('sem a fabrica do cliente SQL a lista nao liga', () => {
    const m = montarListaPedidos({ DATABASE_URL_APP_SYSTEM: 'postgres://app_system@localhost/teste' });
    expect(m.options).toBeUndefined();
    expect(m.pendencias.length).toBeGreaterThan(0);
  });

  it('com a variavel e a fabrica liga sem chave de geocodificacao nem token de mapa; o servico nao tem porta geo', () => {
    const fabrica = vi.fn(() => cliente);
    const m = montarListaPedidos(
      { DATABASE_URL_APP_SYSTEM: 'postgres://app_system@localhost/teste' },
      { abrirCliente: fabrica, relogio: { nowMs: () => AGORA } },
    );
    expect(m.pendencias).toEqual([]);
    expect(m.options).toBeDefined();
    expect(Object.keys(m.options?.service ?? {}).sort()).toEqual(['clock', 'store']);
    expect(fabrica).toHaveBeenCalledTimes(1);
  });
});
