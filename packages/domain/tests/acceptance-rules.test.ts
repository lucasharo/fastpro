// H-058 (Issue #71) | Testes unitarios das regras puras do aceite (162-DESENHO-H058.md, §7, fatia 1).
// Sem rede, sem banco. Cobre T-H058-03, T-H058-04, T-H058-05, T-H058-06 (parte pura) e T-H058-33.
import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_ERROR_CODES,
  ACCEPTANCE_NEUTRAL_MESSAGE,
  ACCEPTANCE_OUTCOMES,
  ACCEPTANCE_SYSTEM_MESSAGE_V1,
  acceptanceOutcomeResponse,
  capacidadeDoPedido,
  isAcceptanceRequestId,
  montarEnvelopeAceite,
  normalizeAcceptanceIdempotencyKey,
  renderAcceptanceSystemMessage,
  requestAcceptanceHash,
  validarCorpoAceite,
  waveDoSlot,
  type AcceptanceRecord,
} from '../src/acceptance/index.js';

const PEDIDO = '11111111-2222-4333-8444-555555555555';
const CHAVE_V4 = '6f1c2b3a-4d5e-4f60-8a71-92b3c4d5e6f7';

describe('validarCorpoAceite (T-H058-03, T-H058-05)', () => {
  it('aceita corpo ausente e objeto vazio', () => {
    expect(validarCorpoAceite(undefined)).toEqual({ ok: true });
    expect(validarCorpoAceite({})).toEqual({ ok: true });
  });

  it('recusa qualquer propriedade ou valor nao vazio com campos_extras_recusados', () => {
    for (const corpo of [
      { price: 1 },
      { deadline_days: 3 },
      { message: 'oi' },
      { attachment: 'x' },
      [],
      null,
      'texto',
    ]) {
      expect(validarCorpoAceite(corpo)).toEqual({ ok: false, code: 'campos_extras_recusados' });
    }
  });

  it('recusa corpo acima de 1 KiB com corpo_invalido', () => {
    expect(validarCorpoAceite({}, 1025)).toEqual({ ok: false, code: 'corpo_invalido' });
    expect(validarCorpoAceite({}, 1024)).toEqual({ ok: true });
  });
});

describe('normalizeAcceptanceIdempotencyKey (T-H058-04)', () => {
  it('aceita UUID versao 4 com variante RFC e devolve minusculas', () => {
    expect(normalizeAcceptanceIdempotencyKey(CHAVE_V4.toUpperCase())).toBe(CHAVE_V4);
  });

  it('recusa formato invalido, versao diferente de 4 e variante errada', () => {
    expect(normalizeAcceptanceIdempotencyKey('chave-invalida-123')).toBeNull();
    expect(normalizeAcceptanceIdempotencyKey('6f1c2b3a-4d5e-1f60-8a71-92b3c4d5e6f7')).toBeNull();
    expect(normalizeAcceptanceIdempotencyKey('6f1c2b3a-4d5e-4f60-1a71-92b3c4d5e6f7')).toBeNull();
    expect(normalizeAcceptanceIdempotencyKey(undefined)).toBeNull();
    expect(normalizeAcceptanceIdempotencyKey(42)).toBeNull();
  });
});

describe('isAcceptanceRequestId (T-H058-06, parte pura)', () => {
  it('aceita UUID canonico e recusa id malformado', () => {
    expect(isAcceptanceRequestId(PEDIDO)).toBe(true);
    expect(isAcceptanceRequestId('nao-e-uuid')).toBe(false);
    expect(isAcceptanceRequestId('')).toBe(false);
  });
});

describe('requestAcceptanceHash (A-7)', () => {
  it('e deterministico, ignora caixa e muda com o pedido', () => {
    expect(requestAcceptanceHash(PEDIDO)).toBe(requestAcceptanceHash(PEDIDO.toUpperCase()));
    expect(requestAcceptanceHash(PEDIDO)).not.toBe(
      requestAcceptanceHash('66666666-7777-4888-8999-aaaaaaaaaaaa'),
    );
    expect(requestAcceptanceHash(PEDIDO)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('capacidade e onda', () => {
  it('capacidade 4 sem a segunda onda e 8 depois de aberta', () => {
    expect(capacidadeDoPedido(false)).toBe(4);
    expect(capacidadeDoPedido(true)).toBe(8);
  });

  it('vaga 1..4 e onda 1; 5..8 e onda 2; fora do intervalo lanca erro', () => {
    expect([1, 4].map(waveDoSlot)).toEqual([1, 1]);
    expect([5, 8].map(waveDoSlot)).toEqual([2, 2]);
    expect(() => waveDoSlot(0)).toThrow(RangeError);
    expect(() => waveDoSlot(9)).toThrow(RangeError);
    expect(() => waveDoSlot(1.5)).toThrow(RangeError);
  });
});

describe('mensagem de sistema (T-H058-27 parte textual)', () => {
  it('renderiza a versao 1 com o texto fixo e recusa versao desconhecida', () => {
    expect(renderAcceptanceSystemMessage(1)).toBe('Estou disponível para trabalhar');
    expect(ACCEPTANCE_SYSTEM_MESSAGE_V1).toBe('Estou disponível para trabalhar');
    expect(renderAcceptanceSystemMessage(2)).toBeNull();
  });
});

describe('acceptanceOutcomeResponse (CA-07, CA-11, §3.3)', () => {
  it('mapeia cada outcome a um status HTTP', () => {
    const esperado: Record<string, number> = {
      criado: 201,
      existente: 200,
      profissional_inelegivel: 403,
      pedido_nao_encontrado: 404,
      admissao_encerrada: 409,
      autoaceite_proibido: 403,
      servico_ou_raio_incompativel: 403,
      reaceite_proibido: 409,
      aceite_duplicado_identidade: 409,
      sem_vagas: 409,
    };
    for (const outcome of ACCEPTANCE_OUTCOMES) {
      expect(acceptanceOutcomeResponse(outcome).status).toBe(esperado[outcome]);
    }
  });

  it('so sem_vagas e admissao_encerrada levam mensagem neutra, sem numeros', () => {
    for (const outcome of ACCEPTANCE_OUTCOMES) {
      const r = acceptanceOutcomeResponse(outcome);
      if (outcome === 'sem_vagas' || outcome === 'admissao_encerrada') {
        expect(r.message).toBe(ACCEPTANCE_NEUTRAL_MESSAGE);
        expect(r.message).not.toMatch(/\d/);
      } else {
        expect(r.message).toBeUndefined();
      }
    }
  });

  it('profissional_inelegivel e uniforme: codigo unico, sem motivo', () => {
    expect(acceptanceOutcomeResponse('profissional_inelegivel')).toEqual({
      status: 403,
      code: 'profissional_inelegivel',
    });
  });
});

describe('montarEnvelopeAceite (T-H058-28, A-8)', () => {
  const base: AcceptanceRecord = {
    id: '22222222-3333-4444-8555-666666666666',
    requestId: PEDIDO,
    slotNo: 3,
    wave: 1,
    status: 'ativo',
    acceptedAt: '2026-11-20T12:00:00.000Z',
    conversationId: '33333333-4444-4555-8666-777777777777',
    conversationState: 'ativa',
    firstName: 'Carlos',
  };

  it('devolve exatamente as chaves do contrato, com primeiro nome so se ativo', () => {
    const env = montarEnvelopeAceite(base);
    expect(Object.keys(env)).toEqual(['acceptance', 'conversation', 'customer']);
    expect(Object.keys(env.acceptance)).toEqual([
      'id',
      'requestId',
      'slotNo',
      'wave',
      'status',
      'acceptedAt',
    ]);
    expect(Object.keys(env.conversation)).toEqual(['id', 'state']);
    expect(env.customer).toEqual({ firstName: 'Carlos' });
  });

  it('zera o primeiro nome quando o aceite nao esta ativo', () => {
    expect(montarEnvelopeAceite({ ...base, status: 'retirado' }).customer.firstName).toBeNull();
    expect(
      montarEnvelopeAceite({ ...base, status: 'removido_por_seguranca' }).customer.firstName,
    ).toBeNull();
  });
});

describe('codigos e textos do contrato (T-H058-33)', () => {
  it('nenhum codigo, mensagem ou modelo traz as expressoes proibidas', () => {
    const proibidas = /n[aã]o [eé] contrato|apenas conecta/i;
    const textos = [
      ACCEPTANCE_NEUTRAL_MESSAGE,
      ACCEPTANCE_SYSTEM_MESSAGE_V1,
      ...ACCEPTANCE_ERROR_CODES,
    ];
    for (const t of textos) expect(t).not.toMatch(proibidas);
  });
});
