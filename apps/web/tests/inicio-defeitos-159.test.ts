// Issue #159 (F0, reproducao) | Defeito 1 na inicial: a porta de rascunho responde 403 `not_draft` sem cookie.
// O fake imita a porta: sem cookie, sugestao 403; POST /drafts cria o cookie; com cookie, sugestao 200.
import { describe, it, expect } from 'vitest';
import { ADDRESS_NEUTRAL_MESSAGE } from '../public/address-field.js';
import { ligarPagina } from '../public/inicio.js';
import {
  criarJanela,
  digitar,
  esperar,
  escolherPrimeiroServico,
  rotaComBusca,
} from './inicio-dom-simulado';

const VISAO_RASCUNHO_159 = {
  id: 'rascunho-159',
  status: 'aberto',
  service_id: 'svc-1',
  service_name: 'Eletricista',
  address_text: null,
  urgency: null,
  description: null,
  expires_at: '2026-11-28T00:00:00.000Z',
  updated_at: '2026-11-21T00:00:00.000Z',
};

function portaDeRascunho159() {
  const porta = { cookie: false, recusadas: 0 };
  const roteador = rotaComBusca((url, chamada) => {
    if (url === '/api/v1/drafts/current') {
      return porta.cookie
        ? { status: 200, corpo: VISAO_RASCUNHO_159 }
        : { status: 404, corpo: { code: 'nao_encontrado' } };
    }
    if (url === '/api/v1/drafts' && chamada.method === 'POST') {
      porta.cookie = true;
      return { status: 201, corpo: VISAO_RASCUNHO_159 };
    }
    if (url === '/api/v1/geo/address-suggest') {
      if (!porta.cookie) {
        porta.recusadas += 1;
        return { status: 403, corpo: { code: 'not_draft' } };
      }
      return { status: 200, corpo: { mode: 'ok', items: [{ label: 'Rua das Flores, 10' }] } };
    }
    return undefined;
  });
  return { porta, roteador };
}

describe('defeito #159 na inicial: sugestao de endereco na primeira visita (CA-159-00, CA-159-01)', () => {
  it('primeira visita: escolher o servico e digitar o endereco nao mostra falha nem recebe 403', async () => {
    const { porta, roteador } = portaDeRascunho159();
    const ctx = criarJanela(roteador);
    ligarPagina(ctx.janela);
    await escolherPrimeiroServico(ctx);
    digitar(ctx.documento.getElementById('endereco'), 'Rua das');
    ctx.rodarTimers();
    await esperar();
    expect(ctx.documento.getElementById('endereco-aviso').textContent).not.toBe(ADDRESS_NEUTRAL_MESSAGE);
    expect(porta.recusadas).toBe(0);
  });
});
