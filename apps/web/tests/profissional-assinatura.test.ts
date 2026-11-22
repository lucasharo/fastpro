// E5 (Issues 60 a 67) | Tela de assinatura: textos, valores e leitura do retorno do checkout (sem rede).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  formatarReais,
  lerRetorno,
  porMes,
  textoSituacao,
} from '../public/profissional-assinatura.js';

const HTML = readFileSync(
  new URL('../public/profissional-assinatura.html', import.meta.url),
  'utf8',
);
const JS = readFileSync(new URL('../public/profissional-assinatura.js', import.meta.url), 'utf8');

describe('valores e textos', () => {
  it('formata centavos em reais', () => {
    expect(formatarReais(2990)).toBe('R$ 29,90');
    expect(formatarReais(23880)).toBe('R$ 238,80');
    expect(formatarReais(123456)).toBe('R$ 1.234,56');
  });

  it('mostra o equivalente mensal do plano anual', () => {
    expect(porMes({ amount_cents: 23880, months: 12 })).toBe('R$ 19,90/mês');
  });

  it('descreve a situacao com o fim do acesso e a renovacao', () => {
    const t = textoSituacao({
      estado: 'ativa',
      access_until: '2031-04-10T15:00:00.000Z',
      plan: 'mensal',
      auto_renew: true,
    });
    expect(t).toBe(
      'Assinatura ativa (até 10/04/2031). Plano Mensal. Renovação automática no cartão ligada.',
    );
    expect(
      textoSituacao({ estado: 'em_carencia', access_until: null, plan: null, auto_renew: false }),
    ).toContain('carência de 72 horas');
  });
});

describe('retorno do Mercado Pago', () => {
  it('le payment_id, collection_id e preapproval_id; ignora valor invalido', () => {
    expect(lerRetorno('?payment_id=123&status=approved')).toEqual({
      paymentId: '123',
      preapprovalId: null,
    });
    expect(lerRetorno('?collection_id=456')).toEqual({ paymentId: '456', preapprovalId: null });
    expect(lerRetorno('?preapproval_id=2c93808')).toEqual({
      paymentId: null,
      preapprovalId: '2c93808',
    });
    expect(lerRetorno('?payment_id=null')).toEqual({ paymentId: null, preapprovalId: null });
    expect(lerRetorno('?payment_id=<script>')).toEqual({ paymentId: null, preapprovalId: null });
  });
});

describe('marcacao e seguranca', () => {
  it('sem boleto, sem campo de cartao e sem script ou estilo inline', () => {
    expect(HTML).not.toMatch(/boleto"|name="(card|cartao_numero|cvv)/i);
    expect(HTML).not.toMatch(/<style[\s>]|\sstyle=/);
    expect(HTML).toContain('<script type="module" src="/profissional-assinatura.js"></script>');
  });

  it('o script so chama a propria API e nao usa HTML dinamico nem armazenamento', () => {
    expect(JS).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|document\.cookie|console\./,
    );
    for (const m of JS.matchAll(/api\('([^']+)'/g)) expect(m[1]).toMatch(/^\/v1\/billing\//);
  });
});
