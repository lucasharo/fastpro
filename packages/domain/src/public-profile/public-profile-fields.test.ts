// Issue 56 (H-043) | Testes da montagem do perfil publico (docs/factory/143-DESENHO-H043.md, §8: T43-02, T43-03, T43-04, T43-09, T43-11).
import { describe, expect, it } from 'vitest';
import { montarPerfilPublico, PUBLIC_PROFILE_TEXTS } from './index.js';

const linhaValida = {
  publicName: 'Ana Teste',
  slug: 'ana-teste',
  verified: true,
  services: [
    {
      groupName: 'Limpeza',
      items: [
        { name: 'Faxina residencial', modalities: ['online', 'presencial'] },
        { name: 'Passadoria', modalities: ['presencial'] },
      ],
    },
  ],
  rating: { average: null, count: 0 },
};

describe('T43-02 montagem por lista fechada', () => {
  it('devolve exatamente as chaves permitidas em todos os niveis', () => {
    const r = montarPerfilPublico(linhaValida);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.perfil).sort()).toEqual(
      ['publicName', 'rating', 'recentReviews', 'services', 'slug', 'verificationBadge', 'verified'].sort(),
    );
    expect(r.perfil.verified).toBe(true);
    expect(Object.keys(r.perfil.rating).sort()).toEqual(['average', 'count', 'label'].sort());
    expect(Object.keys(r.perfil.verificationBadge).sort()).toEqual(['disclaimer', 'label']);
    expect(Object.keys(r.perfil.services[0]).sort()).toEqual(['groupName', 'items']);
    expect(Object.keys(r.perfil.services[0].items[0]).sort()).toEqual(['modalities', 'name']);
  });

  it('acrescenta o selo e a reputacao a partir dos textos unicos', () => {
    const r = montarPerfilPublico(linhaValida);
    if (!r.ok) throw new Error('esperado ok');
    expect(r.perfil.verificationBadge.label).toBe('Identidade verificada');
    expect(r.perfil.verificationBadge.disclaimer).toBe(PUBLIC_PROFILE_TEXTS.textoLimitacaoSelo);
    expect(r.perfil.rating).toEqual({ average: null, count: 0, label: 'Ainda sem avaliações' });
    expect(r.perfil.recentReviews).toEqual([]);
  });
});

describe('T43-03 e T43-04 descarte de chaves fora da lista', () => {
  it('nao repassa telefone, e-mail, identificadores, documento, base nem acesso comercial', () => {
    const suja = {
      ...linhaValida,
      phone: '5511999990000',
      email: 'ana@example.test',
      userId: 'uuid-interno',
      user_id: 'uuid-interno',
      document_enc: 'segredo',
      radius_m: 5000,
      base_point: 'POINT(1 1)',
      commercial_access: true,
    };
    const r = montarPerfilPublico(suja);
    if (!r.ok) throw new Error('esperado ok');
    const texto = JSON.stringify(r.perfil);
    for (const proibido of ['5511999990000', 'ana@example.test', 'uuid-interno', 'segredo', 'POINT', 'commercial']) {
      expect(texto.includes(proibido)).toBe(false);
    }
  });
});

describe('T43-11 servicos e estados de entrada', () => {
  it('aceita lista de servicos vazia', () => {
    const r = montarPerfilPublico({ ...linhaValida, services: [] });
    expect(r.ok && r.perfil.services).toEqual([]);
  });

  it('recusa entrada que nao e objeto', () => {
    expect(montarPerfilPublico(null)).toEqual({ ok: false, motivo: 'entrada_invalida' });
    expect(montarPerfilPublico([])).toEqual({ ok: false, motivo: 'entrada_invalida' });
  });

  it('recusa slug fora do padrao, nome curto e modalidade desconhecida', () => {
    expect(montarPerfilPublico({ ...linhaValida, slug: 'Com Maiuscula' }).ok).toBe(false);
    expect(montarPerfilPublico({ ...linhaValida, slug: 'a'.repeat(101) }).ok).toBe(false);
    expect(montarPerfilPublico({ ...linhaValida, publicName: 'A' }).ok).toBe(false);
    const modalidadeErrada = {
      ...linhaValida,
      services: [{ groupName: 'G', items: [{ name: 'S', modalities: ['ambos'] }] }],
    };
    expect(montarPerfilPublico(modalidadeErrada).ok).toBe(false);
  });

  it('recusa modalidade repetida e item sem modalidade', () => {
    const repetida = { ...linhaValida, services: [{ groupName: 'G', items: [{ name: 'S', modalities: ['online', 'online'] }] }] };
    expect(montarPerfilPublico(repetida).ok).toBe(false);
    const semModalidade = { ...linhaValida, services: [{ groupName: 'G', items: [{ name: 'S', modalities: [] }] }] };
    expect(montarPerfilPublico(semModalidade).ok).toBe(false);
  });
});
