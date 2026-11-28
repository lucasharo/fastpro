// Sugestao do endereco base: a sessao libera sem rascunho; nos pedidos continua valendo o rascunho.
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@fastpro/domain';
import { comSessaoNoEnderecoBase, type SessaoSugestao } from '../src/geo/composicao-sugestao.js';
import type { DraftGatePort } from '../src/geo/ports.js';

const semRascunho: DraftGatePort = { check: async () => ({ status: 'no_principal' }) };
const clock = { nowMs: () => 0 };
const sessoes: SessaoSugestao = { authenticate: async () => ({ userId: 'u1' }) };
const cookie = `${SESSION_COOKIE_NAME}=segredo`;

describe('sugestao de endereco com sessao', () => {
  it('libera o endereco base para quem esta logado', async () => {
    const porta = comSessaoNoEnderecoBase(semRascunho, sessoes, clock);
    expect(await porta.check('professional_base', cookie)).toEqual({ status: 'ok', principal: 'sessao:u1' });
  });

  it('nao libera o pedido, nem sem cookie, nem com sessao invalida', async () => {
    const porta = comSessaoNoEnderecoBase(semRascunho, sessoes, clock);
    expect(await porta.check('request_draft', cookie)).toEqual({ status: 'no_principal' });
    expect(await porta.check('professional_base', undefined)).toEqual({ status: 'no_principal' });
    const invalida = comSessaoNoEnderecoBase(semRascunho, { authenticate: async () => null }, clock);
    expect(await invalida.check('professional_base', cookie)).toEqual({ status: 'no_principal' });
  });

  it('falha do banco responde indisponivel', async () => {
    const porta = comSessaoNoEnderecoBase(
      semRascunho,
      { authenticate: async () => Promise.reject(new Error('banco')) },
      clock,
    );
    expect(await porta.check('professional_base', cookie)).toEqual({ status: 'indisponivel' });
  });
});
