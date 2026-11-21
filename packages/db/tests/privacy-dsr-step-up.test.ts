// Issue 120 (H-111) | Testes unitarios do step-up do titular (147-DESENHO-H111 §3.2, §5.1): servico, ponte SQL falsa e
// decorador de envio. Sem banco e sem rede. Codigo, token e pepper nunca aparecem em mensagem de falha.
import { randomBytes } from 'node:crypto';
import type { EmailMessage, EmailProviderPort } from '@fastpro/domain';
import { describe, expect, it } from 'vitest';
import { challengeHmacHex, challengeSha256Hex } from '../src/challenges-crypto.js';
import {
  DSR_STEPUP_TEMPLATE,
  DsrStepUpConfiguracaoInvalida,
  DsrStepUpEmailProvider,
  ServicoDsrStepUp,
  type DsrStepUpSqlPort,
  type DsrStepUpSqlResposta,
} from '../src/privacy-dsr-step-up.js';

const USUARIO = '11111111-1111-4111-8111-111111111111';
const PEPPER = 'dummy-pepper-sintetico-dsr-step-up-120';
const OUTBOX = '33333333-3333-4333-8333-333333333333';

interface Captura {
  emitido?: { codigoId: string; hmac: string; enc: Buffer };
  consumido: boolean;
  hmacConfirmado?: string;
  grantHash?: string;
}

function sqlFalso(
  cap: Captura,
  resp: { emitir?: DsrStepUpSqlResposta; confirmar?: DsrStepUpSqlResposta } = {},
): DsrStepUpSqlPort {
  return {
    async emitir(_usuario, codigoId, codigoHmac, codigoEnc) {
      cap.emitido = { codigoId, hmac: codigoHmac, enc: codigoEnc };
      return resp.emitir ?? { resultado: 'criado', outboxId: OUTBOX, expiresAt: null, retryAfter: null };
    },
    async confirmar(_usuario, codigoHmac, grantHash) {
      cap.hmacConfirmado = codigoHmac;
      cap.grantHash = grantHash;
      if (resp.confirmar !== undefined) return resp.confirmar;
      cap.consumido = true;
      return { resultado: 'ok', outboxId: null, expiresAt: '2026-11-20T12:15:00.000Z', retryAfter: null };
    },
    async selado(codigoId) {
      if (cap.consumido || cap.emitido === undefined || cap.emitido.codigoId !== codigoId) return null;
      return cap.emitido.enc;
    },
  };
}

function servico(cap: Captura, resp?: { emitir?: DsrStepUpSqlResposta; confirmar?: DsrStepUpSqlResposta }) {
  return new ServicoDsrStepUp({ sql: sqlFalso(cap, resp), chave: randomBytes(32), pepperCodigo: PEPPER });
}

function capturaVazia(): Captura {
  return { consumido: false };
}

describe('ServicoDsrStepUp: configuracao', () => {
  it('recusa chave que nao tem 32 bytes e pepper curto', () => {
    const cap = capturaVazia();
    expect(
      () => new ServicoDsrStepUp({ sql: sqlFalso(cap), chave: randomBytes(16), pepperCodigo: PEPPER }),
    ).toThrow(DsrStepUpConfiguracaoInvalida);
    expect(
      () => new ServicoDsrStepUp({ sql: sqlFalso(cap), chave: randomBytes(32), pepperCodigo: 'curto' }),
    ).toThrow(DsrStepUpConfiguracaoInvalida);
  });
});

describe('ServicoDsrStepUp: emissao', () => {
  it('guarda so HMAC e blob cifrado, sem o codigo em claro, e devolve criado com a saida', async () => {
    const cap = capturaVazia();
    const s = servico(cap);
    const r = await s.emitir(USUARIO);
    expect(r).toEqual({ resultado: 'criado', outboxId: OUTBOX });
    expect(cap.emitido?.hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(cap.emitido?.enc.length).toBeGreaterThan(0);
    const codigo = await s.codigoParaEnvio(cap.emitido?.codigoId ?? '');
    expect(codigo).toMatch(/^[0-9]{6}$/);
    expect(cap.emitido?.enc.toString('utf8')).not.toContain(codigo ?? '#');
  });

  it('o codigo recuperado para o envio bate com o HMAC guardado (ida e volta)', async () => {
    const cap = capturaVazia();
    const s = servico(cap);
    await s.emitir(USUARIO);
    const codigo = (await s.codigoParaEnvio(cap.emitido?.codigoId ?? '')) ?? '';
    expect(challengeHmacHex(PEPPER, `${USUARIO}|${codigo}`)).toBe(cap.emitido?.hmac);
  });

  it('limite e bloqueio na emissao devolvem o tempo de espera', async () => {
    const cap = capturaVazia();
    const r = await servico(cap, {
      emitir: { resultado: 'limite', outboxId: null, expiresAt: null, retryAfter: 120 },
    }).emitir(USUARIO);
    expect(r).toEqual({ resultado: 'limite', retryAfter: 120 });
  });

  it('usuario fora do formato UUID nao chega ao banco', async () => {
    const cap = capturaVazia();
    await expect(servico(cap).emitir('nao-e-uuid')).rejects.toThrow();
    expect(cap.emitido).toBeUndefined();
  });
});

describe('ServicoDsrStepUp: confirmacao', () => {
  it('codigo correto devolve token de uso unico e envia ao banco so o hash do token', async () => {
    const cap = capturaVazia();
    const s = servico(cap);
    await s.emitir(USUARIO);
    const codigo = (await s.codigoParaEnvio(cap.emitido?.codigoId ?? '')) ?? '';
    const r = await s.confirmar(USUARIO, codigo);
    expect(r.resultado).toBe('ok');
    if (r.resultado !== 'ok') return;
    expect(r.token.length).toBeGreaterThan(20);
    expect(cap.grantHash).toBe(challengeSha256Hex(r.token));
    expect(cap.grantHash).not.toBe(r.token);
  });

  it('formato errado do codigo nao chega ao banco', async () => {
    const cap = capturaVazia();
    const r = await servico(cap).confirmar(USUARIO, '12345');
    expect(r).toEqual({ resultado: 'invalido' });
    expect(cap.hmacConfirmado).toBeUndefined();
  });

  it('bloqueio na confirmacao devolve o tempo de espera', async () => {
    const cap = capturaVazia();
    const r = await servico(cap, {
      confirmar: { resultado: 'bloqueado', outboxId: null, expiresAt: null, retryAfter: 900 },
    }).confirmar(USUARIO, '123456');
    expect(r).toEqual({ resultado: 'bloqueado', retryAfter: 900 });
  });
});

describe('DsrStepUpEmailProvider: troca da referencia pelo codigo no envio', () => {
  function provedorFalso() {
    const enviados: EmailMessage[] = [];
    const inner = {
      name: 'fake',
      async send(m: EmailMessage) {
        enviados.push(m);
        return { kind: 'enviado', providerMessageId: 'x' } as never;
      },
    } as unknown as EmailProviderPort;
    return { enviados, inner };
  }

  it('substitui challenge_ref pelo codigo em memoria e mantem os minutos', async () => {
    const cap = capturaVazia();
    const s = servico(cap);
    await s.emitir(USUARIO);
    const codigo = (await s.codigoParaEnvio(cap.emitido?.codigoId ?? '')) ?? '';
    const { enviados, inner } = provedorFalso();
    const provider = new DsrStepUpEmailProvider(inner, s, 10);
    await provider.send({ templateKey: DSR_STEPUP_TEMPLATE, params: { challenge_ref: cap.emitido?.codigoId }, to: 'x' } as never);
    expect(provider.name).toBe('fake');
    expect(enviados[0]?.params).toEqual({ code: codigo, minutos: 10 });
  });

  it('recusa referencia invalida e blob ausente sem chamar o provedor', async () => {
    const cap = capturaVazia();
    const s = servico(cap);
    const { enviados, inner } = provedorFalso();
    const provider = new DsrStepUpEmailProvider(inner, s, 10);
    const ruim = await provider.send({ templateKey: DSR_STEPUP_TEMPLATE, params: { challenge_ref: 'nao-uuid' }, to: 'x' } as never);
    expect(ruim).toEqual({ kind: 'recusa_permanente', code: 'desafio_inativo' });
    const ausente = await provider.send({
      templateKey: DSR_STEPUP_TEMPLATE,
      params: { challenge_ref: '44444444-4444-4444-8444-444444444444' },
      to: 'x',
    } as never);
    expect(ausente).toEqual({ kind: 'recusa_permanente', code: 'segredo_indisponivel' });
    expect(enviados).toHaveLength(0);
  });

  it('outros modelos seguem para o provedor original sem alteracao', async () => {
    const { enviados, inner } = provedorFalso();
    const provider = new DsrStepUpEmailProvider(inner, servico(capturaVazia()), 10);
    const mensagem = { templateKey: 'acesso_login', params: { link: 'https://example.test/x' }, to: 'x' } as never;
    await provider.send(mensagem);
    expect(enviados[0]).toBe(mensagem);
  });
});
