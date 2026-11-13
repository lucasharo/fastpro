// H-036 | Validacao pura da oferta do perfil profissional (docs/factory/99-DESENHO-H036.md, §2, §4; CA-01, CA-03,
// CA-04, CA-07; decisoes 109, 112). Sem banco, sem rede e com valores sinteticos.
import { describe, expect, it } from 'vitest';
import {
  checkProfessionalAreaInput,
  checkProfessionalServicesInput,
  groupServiceRows,
  RADIUS_KM_MAX,
  RADIUS_KM_MIN,
  servicesFieldFor,
  type ServiceRow,
} from '../src/professional/offering.js';

const SERVICO_A = '11111111-1111-4111-8111-111111111111';
const SERVICO_B = '22222222-2222-4222-8222-222222222222';
const SERVICO_C = '33333333-3333-4333-8333-333333333333';
const ENDERECO = 'Rua Sintetica, 100, Centro, Cidade Exemplo';

describe('checkProfessionalAreaInput (CA-07, decisao 112)', () => {
  it('aceita o raio inteiro nas duas bordas, 5 e 100 km', () => {
    expect(checkProfessionalAreaInput({ radiusKm: RADIUS_KM_MIN })).toEqual({
      ok: true,
      value: { radiusKm: 5 },
    });
    expect(checkProfessionalAreaInput({ radiusKm: RADIUS_KM_MAX })).toEqual({
      ok: true,
      value: { radiusKm: 100 },
    });
  });

  it.each([4, 101, 0, -5, 5.5, '5', null, true])('recusa o raio %j com raio_invalido', (raio) => {
    expect(checkProfessionalAreaInput({ radiusKm: raio })).toEqual({ ok: false, code: 'raio_invalido' });
  });

  it('recusa corpo sem campo nenhum com dados_incompletos', () => {
    expect(checkProfessionalAreaInput({})).toEqual({ ok: false, code: 'dados_incompletos' });
  });

  it('recusa campo extra e corpo que nao e objeto com formato', () => {
    expect(checkProfessionalAreaInput({ radiusKm: 5, latitude: -23.5 })).toEqual({ ok: false, code: 'formato' });
    expect(checkProfessionalAreaInput([{ radiusKm: 5 }])).toEqual({ ok: false, code: 'formato' });
    expect(checkProfessionalAreaInput(null)).toEqual({ ok: false, code: 'formato' });
  });

  it('recusa endereco curto ou so de controles com endereco_invalido', () => {
    expect(checkProfessionalAreaInput({ addressText: 'ab' })).toEqual({ ok: false, code: 'endereco_invalido' });
    expect(checkProfessionalAreaInput({ addressText: '\u0001\u0002' })).toEqual({
      ok: false,
      code: 'endereco_invalido',
    });
  });

  it('aceita so o endereco e devolve o texto normalizado e a chave', () => {
    const r = checkProfessionalAreaInput({ addressText: ENDERECO });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.radiusKm).toBeUndefined();
    expect(typeof r.value.addressText).toBe('string');
    expect(typeof r.value.addressKey).toBe('string');
  });

  it('aceita endereco e raio no mesmo pedido', () => {
    const r = checkProfessionalAreaInput({ addressText: ENDERECO, radiusKm: 20 });
    expect(r.ok && r.value.radiusKm).toBe(20);
  });
});

describe('checkProfessionalServicesInput (CA-01, CA-03, decisao 109)', () => {
  it('expande "ambos" em duas linhas, uma por modalidade', () => {
    const r = checkProfessionalServicesInput(
      { services: [{ serviceId: SERVICO_A, modalities: ['presencial', 'online'] }] },
      30,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toEqual([
      { serviceId: SERVICO_A, modality: 'presencial', index: 0 },
      { serviceId: SERVICO_A, modality: 'online', index: 0 },
    ]);
  });

  it('aceita lista vazia (remove tudo) e normaliza o identificador para minusculas', () => {
    expect(checkProfessionalServicesInput({ services: [] }, 30)).toEqual({ ok: true, services: [], items: [] });
    const r = checkProfessionalServicesInput(
      { services: [{ serviceId: SERVICO_A.toUpperCase(), modalities: ['online'] }] },
      30,
    );
    expect(r.ok && r.services[0]?.serviceId).toBe(SERVICO_A);
  });

  it('recusa identificador malformado, repetido ou modalidade invalida com o indice do item', () => {
    const malformado = checkProfessionalServicesInput({ services: [{ serviceId: 'x', modalities: ['online'] }] }, 30);
    expect(malformado).toEqual({ ok: false, code: 'formato', index: 0 });

    const repetido = checkProfessionalServicesInput(
      {
        services: [
          { serviceId: SERVICO_A, modalities: ['online'] },
          { serviceId: SERVICO_A, modalities: ['presencial'] },
        ],
      },
      30,
    );
    expect(repetido).toEqual({ ok: false, code: 'formato', index: 1 });

    const modalidadeVazia = checkProfessionalServicesInput({ services: [{ serviceId: SERVICO_A, modalities: [] }] }, 30);
    expect(modalidadeVazia).toEqual({ ok: false, code: 'formato', index: 0 });

    const modalidadeRepetida = checkProfessionalServicesInput(
      { services: [{ serviceId: SERVICO_A, modalities: ['online', 'online'] }] },
      30,
    );
    expect(modalidadeRepetida).toEqual({ ok: false, code: 'formato', index: 0 });

    const modalidadeDesconhecida = checkProfessionalServicesInput(
      { services: [{ serviceId: SERVICO_A, modalities: ['ambos'] }] },
      30,
    );
    expect(modalidadeDesconhecida).toEqual({ ok: false, code: 'formato', index: 0 });
  });

  it('recusa campo extra no corpo ou no item', () => {
    expect(checkProfessionalServicesInput({ services: [], extra: 1 }, 30)).toEqual({ ok: false, code: 'formato' });
    expect(
      checkProfessionalServicesInput(
        { services: [{ serviceId: SERVICO_A, modalities: ['online'], extra: true }] },
        30,
      ),
    ).toEqual({ ok: false, code: 'formato', index: 0 });
  });

  it('recusa acima do maximo de servicos com limite_servicos', () => {
    const r = checkProfessionalServicesInput(
      {
        services: [
          { serviceId: SERVICO_A, modalities: ['online'] },
          { serviceId: SERVICO_B, modalities: ['online'] },
          { serviceId: SERVICO_C, modalities: ['online'] },
        ],
      },
      2,
    );
    expect(r).toEqual({ ok: false, code: 'limite_servicos' });
  });
});

describe('servicesFieldFor e groupServiceRows (CA-01, CA-03)', () => {
  it('monta o campo de erro como services[i] e nulo sem indice', () => {
    expect(servicesFieldFor(2)).toBe('services[2]');
    expect(servicesFieldFor(undefined)).toBeNull();
  });

  it('agrupa as linhas do banco por servico, com modalidades em ordem fixa e ordem por nome', () => {
    const linhas: ServiceRow[] = [
      { serviceId: SERVICO_B, name: 'Yoga', regulated: false, active: true, modality: 'online' },
      { serviceId: SERVICO_A, name: 'Massagem', regulated: false, active: true, modality: 'online' },
      { serviceId: SERVICO_A, name: 'Massagem', regulated: false, active: true, modality: 'presencial' },
    ];
    const grupos = groupServiceRows(linhas);
    expect(grupos.map((g) => g.name)).toEqual(['Massagem', 'Yoga']);
    expect(grupos[0]?.modalities).toEqual(['presencial', 'online']);
    expect(grupos[1]?.modalities).toEqual(['online']);
  });

  it('nao traz campo fora da resposta publica do servico', () => {
    const [grupo] = groupServiceRows([
      { serviceId: SERVICO_A, name: 'Massagem', regulated: true, active: true, modality: 'presencial' },
    ]);
    expect(Object.keys(grupo ?? {}).sort()).toEqual(['active', 'modalities', 'name', 'regulated', 'serviceId']);
  });
});
