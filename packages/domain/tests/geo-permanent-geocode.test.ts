// H-021 | Regras puras da coordenada permanente (docs/factory/68-DESENHO-H021.md, §1 a §5, §7).
// Sem I/O e sem rede. Cobre o mapeamento da resposta, a caixa do Brasil, o teto por pedido,
// o breaker (ausente ou invalido = fechado), a decisao de reserva e o painel (CA-2, CA-4 de dominio, CA-5, CA-6).
import { describe, it, expect } from 'vitest';
import {
  buildQuotaPanel,
  decideBreaker,
  decideReservation,
  isInsideBrazilBox,
  mapPermanentResponse,
  MAPBOX_PERMANENT_UNIT_USD,
  PERMANENT_CALLS_PER_REQUEST_MAX,
  PERMANENT_LEASE_MS,
  periodStartUtc,
  permanentAddressKey,
  parseBreakerCaps,
  type BreakerCaps,
  type GeoReservaEntrada,
} from '../src/geo/permanent-geocode.js';

const feicao = (coordinates: unknown, feature_type: unknown = 'address', extra: object = {}) => ({
  features: [
    {
      geometry: { type: 'Point', coordinates },
      properties: { feature_type, mapbox_id: 'mbx-sintetico-dominio', ...extra },
    },
  ],
});

describe('permanentAddressKey (§2.2, normalizacao)', () => {
  it('normaliza espacos e caixa para a chave e preserva o texto da chamada', () => {
    const r = permanentAddressKey('  Rua   ALFA​ sintetica, 10 ');
    expect(r).toEqual({
      ok: true,
      query: 'Rua ALFA sintetica, 10',
      key: 'rua alfa sintetica, 10',
    });
  });

  it('recusa texto curto demais, longo demais ou que nao e string', () => {
    expect(permanentAddressKey('ab')).toEqual({ ok: false });
    expect(permanentAddressKey('x'.repeat(121))).toEqual({ ok: false });
    expect(permanentAddressKey(12345)).toEqual({ ok: false });
  });
});

describe('caixa do Brasil (§2.1, barra lixo e inversao de eixos)', () => {
  it('aceita pontos dentro da caixa e recusa inversao, fora do Brasil e nao finito', () => {
    expect(isInsideBrazilBox(-46.6333, -23.5505)).toBe(true);
    expect(isInsideBrazilBox(-23.5505, -46.6333)).toBe(false);
    expect(isInsideBrazilBox(-74.006, 40.7128)).toBe(false);
    expect(isInsideBrazilBox(Number.NaN, -23)).toBe(false);
    expect(isInsideBrazilBox(-46, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('mapPermanentResponse (§4, dúvida 8)', () => {
  it('extrai so lon, lat e a precisao do tipo aceito', () => {
    const r = mapPermanentResponse(feicao([-46.6333, -23.5505], 'street'));
    expect(r).toEqual({
      status: 'ponto',
      point: { lon: -46.6333, lat: -23.5505, precision: 'rua' },
    });
  });

  it('mapeia os quatro tipos aceitos para a precisao gravada', () => {
    const tipos: Array<[string, string]> = [
      ['address', 'endereco'],
      ['street', 'rua'],
      ['neighborhood', 'bairro'],
      ['locality', 'localidade'],
    ];
    for (const [tipo, precisao] of tipos) {
      const r = mapPermanentResponse(feicao([-46.6, -23.5], tipo));
      expect(r.status === 'ponto' && r.point.precision).toBe(precisao);
    }
  });

  it('lista vazia e sem resultado; so a primeira feicao e lida (limit=1)', () => {
    expect(mapPermanentResponse({ features: [] })).toEqual({ status: 'sem_resultado' });
    const duas = {
      features: [
        feicao([-46.6, -23.5]).features[0],
        feicao([-10, -10]).features[0],
      ],
    };
    const r = mapPermanentResponse(duas);
    expect(r.status === 'ponto' && r.point.lon).toBe(-46.6);
  });

  it('forma inesperada, tipo grosseiro, coordenada fora do Brasil e corpo nao objeto: provider_shape', () => {
    const ruins: unknown[] = [
      null,
      'texto',
      {},
      { features: null },
      { features: [null] },
      feicao([-46.6, -23.5], 'place'),
      feicao([-46.6], 'address'),
      feicao(['-46.6', '-23.5'], 'address'),
      feicao([10, 10], 'address'),
      { features: [{ geometry: { type: 'LineString', coordinates: [-46, -23] }, properties: { feature_type: 'address' } }] },
    ];
    for (const corpo of ruins) {
      expect(mapPermanentResponse(corpo), JSON.stringify(corpo)).toEqual({ status: 'provider_shape' });
    }
  });

  it('o resultado nunca carrega rotulo, identificador ou propriedades extras', () => {
    const r = mapPermanentResponse(
      feicao([-46.6, -23.5], 'address', { full_address: 'Rua Sintetica 1', coordinates: { lat: 1 } }),
    );
    expect(r.status === 'ponto' && Object.keys(r.point).sort()).toEqual(['lat', 'lon', 'precision']);
    expect(JSON.stringify(r)).not.toContain('mbx-sintetico-dominio');
    expect(JSON.stringify(r)).not.toContain('Rua Sintetica 1');
  });
});

describe('teto de gasto ausente ou invalido = fechado (§5.1, decisao 5)', () => {
  it('aceita tetos inteiros validos', () => {
    expect(parseBreakerCaps('10', '20')).toEqual({ soft: 10, hard: 20 });
    expect(parseBreakerCaps('0', '1')).toEqual({ soft: 0, hard: 1 });
    expect(parseBreakerCaps(' 5 ', ' 5 ')).toEqual({ soft: 5, hard: 5 });
  });

  it('ausente, vazio, nao inteiro, negativo, hard zero ou soft acima de hard: null', () => {
    const invalidos: Array<[string | undefined, string | undefined]> = [
      [undefined, '20'],
      ['10', undefined],
      [undefined, undefined],
      ['', '20'],
      ['10', ''],
      ['1.5', '20'],
      ['-1', '20'],
      ['10', '0'],
      ['30', '20'],
      ['10', '1e3'],
      ['dez', '20'],
    ];
    for (const [s, h] of invalidos) {
      expect(parseBreakerCaps(s, h), `${s}/${h}`).toBeNull();
    }
  });

  it('com teto nulo, nenhuma unidade e permitida', () => {
    expect(decideBreaker(null, 0)).toEqual({ permitido: false, alcancouSoft: false });
    expect(decideBreaker(null, 999)).toEqual({ permitido: false, alcancouSoft: false });
  });
});

describe('breaker da cota (§5.1, CA-5)', () => {
  const caps: BreakerCaps = { soft: 3, hard: 5 };

  it('permite ate o teto e marca quando a reserva alcanca o aviso', () => {
    expect(decideBreaker(caps, 0)).toEqual({ permitido: true, alcancouSoft: false });
    expect(decideBreaker(caps, 2)).toEqual({ permitido: true, alcancouSoft: true });
    expect(decideBreaker(caps, 4)).toEqual({ permitido: true, alcancouSoft: true });
  });

  it('no teto ou acima dele, bloqueia; uso invalido tambem', () => {
    expect(decideBreaker(caps, 5).permitido).toBe(false);
    expect(decideBreaker(caps, 6).permitido).toBe(false);
    expect(decideBreaker(caps, -1).permitido).toBe(false);
    expect(decideBreaker(caps, 1.5).permitido).toBe(false);
  });

  it('aumentar o teto reabre na chamada seguinte', () => {
    expect(decideBreaker({ soft: 3, hard: 5 }, 5).permitido).toBe(false);
    expect(decideBreaker({ soft: 3, hard: 6 }, 5).permitido).toBe(true);
  });
});

describe('periodo da cota (§5.1)', () => {
  it('o mes muda na meia-noite UTC', () => {
    expect(periodStartUtc(Date.parse('2026-01-31T23:59:59Z'))).toBe('2026-01-01');
    expect(periodStartUtc(Date.parse('2026-02-01T00:00:00Z'))).toBe('2026-02-01');
    expect(periodStartUtc(Date.parse('2026-12-31T12:00:00Z'))).toBe('2026-12-01');
  });

  it('instante invalido e erro, nunca periodo sem sentido', () => {
    expect(() => periodStartUtc(Number.NaN)).toThrow(RangeError);
  });
});

describe('decisao de reserva (§3.2, §5.2)', () => {
  const base: GeoReservaEntrada = {
    row: null,
    callsNoPedido: 0,
    callsCap: PERMANENT_CALLS_PER_REQUEST_MAX,
    caps: { soft: 100, hard: 1000 },
    quotaUsed: 0,
    nowMs: 1_000_000,
    leaseMs: PERMANENT_LEASE_MS,
  };

  it('linha livre com teto e cota: chamar', () => {
    expect(decideReservation(base)).toBe('chamar');
  });

  it('ok reutiliza sem chamada, mesmo com teto cheio', () => {
    expect(
      decideReservation({ ...base, row: { state: 'ok', reservedAtMs: null }, callsNoPedido: 3 }),
    ).toBe('reutilizar');
  });

  it('sem resultado nao cobra de novo', () => {
    expect(decideReservation({ ...base, row: { state: 'sem_resultado', reservedAtMs: null } })).toBe(
      'sem_resultado',
    );
  });

  it('reserva viva dentro da concessao: em andamento; vencida: trata como livre', () => {
    const viva = { state: 'reservado' as const, reservedAtMs: base.nowMs - 10_000 };
    expect(decideReservation({ ...base, row: viva })).toBe('em_andamento');
    const vencida = { state: 'reservado' as const, reservedAtMs: base.nowMs - PERMANENT_LEASE_MS };
    expect(decideReservation({ ...base, row: vencida })).toBe('chamar');
  });

  it('teto por pedido bloqueia a 4a chamada e vem antes da cota', () => {
    expect(decideReservation({ ...base, callsNoPedido: 3, quotaUsed: 1000 })).toBe('teto');
    expect(decideReservation({ ...base, callsNoPedido: 2 })).toBe('chamar');
  });

  it('teto ausente ou cota no limite: breaker, sem consumir nada', () => {
    expect(decideReservation({ ...base, caps: null })).toBe('breaker');
    expect(decideReservation({ ...base, quotaUsed: 1000 })).toBe('breaker');
  });

  it('linha aguardando nao consome teto e volta a chamar quando o breaker abre', () => {
    const aguardando = { state: 'aguardando' as const, reservedAtMs: null };
    expect(decideReservation({ ...base, row: aguardando, callsNoPedido: 2 })).toBe('chamar');
    expect(decideReservation({ ...base, row: aguardando, caps: null })).toBe('breaker');
  });
});

describe('painel da cota (§5.3)', () => {
  it('mostra uso, teto, percentual, estado e gasto estimado de lista', () => {
    const painel = buildQuotaPanel({ used: 2, aguardando: 1, caps: { soft: 1, hard: 4 } });
    expect(painel).toEqual({
      used: 2,
      soft: 1,
      hard: 4,
      pct: 50,
      breaker_state: 'fechado',
      motivo_bloqueio: null,
      gasto_estimado_usd_lista: 2 * MAPBOX_PERMANENT_UNIT_USD,
      aguardando: 1,
    });
  });

  it('no teto: aberto, motivo teto, 100%', () => {
    const painel = buildQuotaPanel({ used: 4, aguardando: 0, caps: { soft: 1, hard: 4 } });
    expect(painel).toEqual(
      expect.objectContaining({ breaker_state: 'aberto', motivo_bloqueio: 'teto', pct: 100 }),
    );
  });

  it('teto ausente: aberto por configuracao, sem teto nem percentual', () => {
    const painel = buildQuotaPanel({ used: 0, aguardando: 0, caps: null });
    expect(painel).toEqual(
      expect.objectContaining({
        breaker_state: 'aberto',
        motivo_bloqueio: 'configuracao',
        soft: null,
        hard: null,
        pct: null,
      }),
    );
  });
});
