// H-025 | Porta DraftGate real (apps/api/src/drafts/draft-gate.ts), em memoria: sem banco, sem rede.
// Cobre CA-05 (so o cookie do rascunho vivo abre a geocodificacao) e a regra R5 (sem chamada paga aqui).
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes do DraftGate');
};

import { describe, expect, it } from 'vitest';
import type { DraftRecord, DraftStorePort, DraftWriteResult } from '@fastpro/domain';
import { createDraftGate } from '../src/drafts/draft-gate.js';
import { createDraftHasher } from '../src/drafts/draft-hash.js';

const SEGREDO = 'A'.repeat(43);
const COOKIE = `__Host-fp_draft=${SEGREDO}`;
const T0 = Date.UTC(2026, 10, 11, 12, 0, 0);
const CHAVE_IP = 'k'.repeat(40);
const hasher = createDraftHasher(CHAVE_IP);
const HASH = hasher.secretHash(SEGREDO);

/** Banco falso: registra cada consulta e devolve o que o teste configurar. */
class StoreGate implements DraftStorePort {
  readonly buscas: { readonly hash: string; readonly now: number }[] = [];
  resposta: DraftRecord | null | 'erro' = null;

  async find(hash: string, now: number): Promise<DraftRecord | null> {
    this.buscas.push({ hash, now });
    if (this.resposta === 'erro') throw new Error('falha sintetica do banco');
    return this.resposta;
  }

  async create(): Promise<DraftWriteResult> {
    throw new Error('nao usado pelo DraftGate');
  }

  async patch(): Promise<DraftWriteResult> {
    throw new Error('nao usado pelo DraftGate');
  }

  async discard(): Promise<boolean> {
    throw new Error('nao usado pelo DraftGate');
  }
}

function registro(status: DraftRecord['status']): DraftRecord {
  return {
    id: 'rascunho-sintetico-1',
    status,
    serviceId: null,
    addressText: 'Rua sintetica, 100',
    urgency: null,
    description: null,
    expiresAt: '2026-11-18T12:00:00.000Z',
    updatedAt: '2026-11-11T12:00:00.000Z',
  };
}

function montar(store: StoreGate) {
  return createDraftGate({ store, hasher, clock: { nowMs: () => T0 } });
}

describe('H-025 DraftGate real', () => {
  it('sem cookie: no_principal e nenhuma consulta ao banco', async () => {
    const store = new StoreGate();
    const r = await montar(store).check('cep', undefined);
    expect(r).toEqual({ status: 'no_principal' });
    expect(store.buscas).toHaveLength(0);
  });

  it('cookie malformado (formato errado): no_principal e nenhuma consulta ao banco', async () => {
    const store = new StoreGate();
    const r = await montar(store).check('cep', '__Host-fp_draft=curto');
    expect(r).toEqual({ status: 'no_principal' });
    expect(store.buscas).toHaveLength(0);
  });

  it('cookie repetido: conta como ausente (no_principal) e nao vai ao banco', async () => {
    const store = new StoreGate();
    const r = await montar(store).check('cep', `${COOKIE}; __Host-fp_draft=${SEGREDO}`);
    expect(r).toEqual({ status: 'no_principal' });
    expect(store.buscas).toHaveLength(0);
  });

  it('rascunho aberto: ok com principal = id, consulta pelo hash (nunca pelo segredo) no relogio injetado', async () => {
    const store = new StoreGate();
    store.resposta = registro('aberto');
    const r = await montar(store).check('cep', COOKIE);
    expect(r).toEqual({ status: 'ok', principal: 'rascunho-sintetico-1' });
    expect(store.buscas).toEqual([{ hash: HASH, now: T0 }]);
    expect(store.buscas[0]?.hash).not.toBe(SEGREDO);
  });

  it('rascunho aguardando_email: tambem e ok (estado vivo)', async () => {
    const store = new StoreGate();
    store.resposta = registro('aguardando_email');
    const r = await montar(store).check('cep', COOKIE);
    expect(r).toEqual({ status: 'ok', principal: 'rascunho-sintetico-1' });
  });

  it('cookie de outro navegador ou rascunho vencido (banco sem linha): not_draft', async () => {
    const store = new StoreGate();
    store.resposta = null;
    const r = await montar(store).check('cep', COOKIE);
    expect(r).toEqual({ status: 'not_draft' });
  });

  it('estado fora de aberto e aguardando_email (descartado ou publicado) nunca e ok', async () => {
    for (const status of ['descartado', 'publicado'] as const) {
      const store = new StoreGate();
      store.resposta = registro(status);
      const r = await montar(store).check('cep', COOKIE);
      expect(r).toEqual({ status: 'not_draft' });
    }
  });

  it('falha do banco: indisponivel, sem detalhe', async () => {
    const store = new StoreGate();
    store.resposta = 'erro';
    const r = await montar(store).check('cep', COOKIE);
    expect(r).toEqual({ status: 'indisponivel' });
    expect(JSON.stringify(r)).not.toContain('falha sintetica');
  });

  it('o resultado nunca carrega o segredo nem o hash', async () => {
    const store = new StoreGate();
    store.resposta = registro('aberto');
    const r = JSON.stringify(await montar(store).check('cep', COOKIE));
    expect(r).not.toContain(SEGREDO);
    expect(r).not.toContain(HASH);
  });
});
