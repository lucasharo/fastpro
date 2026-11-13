// Issue 45 (H-032) | Servico de leitura por papel com portas simuladas (sem banco, sem rede).
// Cobre T-05, T-06 (recusas identicas), T-12 (decifragem) e T-15 (sentinela de endereco fora das respostas).
// Chave de teste montada em memoria: nunca vem de .env.local.
import { describe, expect, it } from 'vitest';
import { ELIGIBLE_PROFESSIONAL_KEYS, OWNER_KEYS } from '@fastpro/domain';
import type { OwnerRequestRow, ProfessionalRequestRow } from '@fastpro/db';
import { createAddressVault } from '../src/requests/address-crypto.js';
import {
  readRequestAsOwner,
  readRequestAsProfessional,
  type DetailServiceDeps,
  type VisibilityStorePort,
} from '../src/requests/detail-service.js';

const CHAVE_TESTE = 'chave-de-teste-issue45-leitura-em-memoria-0123456789';
const DONO = '11111111-1111-4111-8111-111111111111';
const PEDIDO = '33333333-3333-4333-8333-333333333333';
const OUTRO_PEDIDO = '77777777-7777-4777-8777-777777777777';
const PROFISSIONAL = '44444444-4444-4444-8444-444444444444';
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);
const ENDERECO_SENTINELA = 'Rua h032-sentinela-endereco 4242, Vila Teste - SP';

const vault = createAddressVault(CHAVE_TESTE);

function linhaDono(over: Partial<OwnerRequestRow> = {}): OwnerRequestRow {
  return {
    id: PEDIDO,
    status: 'publicado',
    serviceId: 'svc-1',
    serviceName: 'Eletricista',
    urgency: 'normal',
    description: 'Troca de tomada',
    firstName: 'Ana',
    addressEnc: vault.seal(ENDERECO_SENTINELA, PEDIDO),
    addressTextLegado: null,
    publicLabel: 'Vila Teste - SP',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(AGORA + 3600_000).toISOString(),
    acceptancesCount: 0,
    ...over,
  };
}

function linhaProfissional(over: Partial<ProfessionalRequestRow> = {}): ProfessionalRequestRow {
  return {
    id: PEDIDO,
    serviceId: 'svc-1',
    serviceName: 'Eletricista',
    urgency: 'normal',
    description: 'Troca de tomada',
    publicLabel: 'Vila Teste - SP',
    distanceKm: 1.5,
    modality: 'presencial',
    publishedAt: new Date(AGORA).toISOString(),
    acceptanceDeadlineAt: new Date(AGORA + 3600_000).toISOString(),
    ...over,
  };
}

function deps(store: Partial<VisibilityStorePort>, v = vault): DetailServiceDeps {
  const porta: VisibilityStorePort = {
    readOwner: async () => null,
    readProfessional: async () => null,
    ...store,
  };
  return { store: porta, vault: v, clock: { nowMs: () => AGORA } };
}

describe('leitura do dono (T-05, T-12)', () => {
  it('devolve o endereco original, com exatamente as chaves do dono na ordem da lista', async () => {
    const r = await readRequestAsOwner(DONO, PEDIDO, deps({ readOwner: async () => linhaDono() }));
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(Object.keys(r.body)).toEqual([...OWNER_KEYS]);
    expect(r.body.addressText).toBe(ENDERECO_SENTINELA);
    expect(JSON.stringify(r.body)).not.toMatch(/addressEnc|geocode|customerUserId|exactPoint/);
  });

  it('linha legada com texto em claro (antes da contracao) segue sem decifrar', async () => {
    const r = await readRequestAsOwner(
      DONO,
      PEDIDO,
      deps({ readOwner: async () => linhaDono({ addressEnc: null, addressTextLegado: 'Rua Legada 1, SP' }) }),
    );
    expect(r.status === 200 && r.body.addressText).toBe('Rua Legada 1, SP');
  });

  it('blob adulterado ou de outro pedido: 503 endereco_indisponivel, sem pedido parcial', async () => {
    const trocado = linhaDono({ addressEnc: vault.seal(ENDERECO_SENTINELA, OUTRO_PEDIDO) });
    const r = await readRequestAsOwner(DONO, PEDIDO, deps({ readOwner: async () => trocado }));
    expect(r).toEqual({ status: 503, body: { code: 'endereco_indisponivel' } });
  });
});

describe('recusas do dono e do profissional sao identicas (T-06, T-07)', () => {
  it('pedido de outro, inexistente, fechado e id mal formado: mesmo 404 constante', async () => {
    const semLinha = deps({ readOwner: async () => null, readProfessional: async () => null });
    const outro = await readRequestAsOwner(DONO, PEDIDO, semLinha);
    const inexistente = await readRequestAsOwner(DONO, OUTRO_PEDIDO, semLinha);
    const malFormado = await readRequestAsOwner(DONO, 'nao-e-uuid', semLinha);
    const profissional = await readRequestAsProfessional(PROFISSIONAL, PEDIDO, semLinha);
    for (const r of [outro, inexistente, malFormado, profissional]) {
      expect(r).toEqual({ status: 404, body: { code: 'pedido_nao_encontrado' } });
    }
  });

  it('id mal formado nao chama o banco', async () => {
    let chamadas = 0;
    const d = deps({
      readOwner: async () => {
        chamadas += 1;
        return null;
      },
    });
    await readRequestAsOwner(DONO, '123', d);
    expect(chamadas).toBe(0);
  });

  it('falha do banco vira 503 visibilidade_indisponivel, sem texto do driver', async () => {
    const d = deps({
      readProfessional: async () => {
        throw new Error('detalhe interno do driver');
      },
    });
    const r = await readRequestAsProfessional(PROFISSIONAL, PEDIDO, d);
    expect(r).toEqual({ status: 503, body: { code: 'visibilidade_indisponivel' } });
    expect(JSON.stringify(r)).not.toContain('detalhe interno');
  });
});

describe('leitura do profissional elegivel (T-01, T-02, T-03)', () => {
  it('corpo exatamente com as dez chaves da RN-10, na ordem, sem endereco nem coordenada', async () => {
    const r = await readRequestAsProfessional(
      PROFISSIONAL,
      PEDIDO,
      deps({ readProfessional: async () => linhaProfissional() }),
    );
    expect(r.status).toBe(200);
    if (r.status !== 200) return;
    expect(Object.keys(r.body)).toEqual([...ELIGIBLE_PROFESSIONAL_KEYS]);
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain(ENDERECO_SENTINELA);
    expect(texto).not.toMatch(/-?\d{1,3}\.\d{4,}/);
    expect(texto).not.toMatch(/firstName|addressText|geocodePointId|customerUserId/);
  });

  it('pedido online: distancia nula e modalidade online', async () => {
    const r = await readRequestAsProfessional(
      PROFISSIONAL,
      PEDIDO,
      deps({ readProfessional: async () => linhaProfissional({ distanceKm: null, modality: 'online' }) }),
    );
    expect(r.status === 200 && r.body.distanceKm).toBeNull();
    expect(r.status === 200 && r.body.modality).toBe('online');
  });
});
