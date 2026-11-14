// Issue 56 (H-043) | Testes do contrato publico do perfil (docs/factory/143-DESENHO-H043.md, §5; T43-02, T43-03).
import { describe, expect, it } from 'vitest';
import { PUBLIC_PROFILE_FORBIDDEN_FIELDS, validatePublicProfileResponse } from './public-profile.js';

const corpoValido = () => ({
  publicName: 'Ana Teste',
  slug: 'ana-teste',
  verified: true,
  verificationBadge: { label: 'Identidade verificada', disclaimer: 'Texto de limitacao.' },
  services: [{ groupName: 'Limpeza', items: [{ name: 'Faxina', modalities: ['online', 'presencial'] }] }],
  rating: { average: null, count: 0, label: 'Ainda sem avaliações' },
  recentReviews: [],
});

describe('T43-02 contrato do corpo 200', () => {
  it('aceita o corpo com a lista fechada', () => {
    expect(validatePublicProfileResponse(corpoValido())).toEqual({ ok: true });
  });

  it('rejeita chave extra no nivel do perfil', () => {
    expect(validatePublicProfileResponse({ ...corpoValido(), extra: 1 }).ok).toBe(false);
  });

  it('rejeita chave extra em selo, reputacao, grupo e item', () => {
    const c = corpoValido();
    expect(validatePublicProfileResponse({ ...c, verificationBadge: { ...c.verificationBadge, x: 1 } }).ok).toBe(false);
    expect(validatePublicProfileResponse({ ...c, rating: { ...c.rating, average: null, x: 1 } }).ok).toBe(false);
    expect(validatePublicProfileResponse({ ...c, services: [{ ...c.services[0], x: 1 }] }).ok).toBe(false);
    expect(
      validatePublicProfileResponse({ ...c, services: [{ groupName: 'G', items: [{ name: 'S', modalities: ['online'], id: 1 }] }] }).ok,
    ).toBe(false);
  });

  it('rejeita campo proibido, verified falso, reputacao nao zerada e modalidade desconhecida', () => {
    for (const campo of PUBLIC_PROFILE_FORBIDDEN_FIELDS) {
      expect(validatePublicProfileResponse({ ...corpoValido(), [campo]: 'x' }).ok, campo).toBe(false);
    }
    expect(validatePublicProfileResponse({ ...corpoValido(), verified: false }).ok).toBe(false);
    expect(validatePublicProfileResponse({ ...corpoValido(), rating: { average: 4.5, count: 2, label: 'x' } }).ok).toBe(false);
    expect(
      validatePublicProfileResponse({ ...corpoValido(), services: [{ groupName: 'G', items: [{ name: 'S', modalities: ['ambos'] }] }] }).ok,
    ).toBe(false);
  });

  it('rejeita corpo que nao e objeto', () => {
    expect(validatePublicProfileResponse(null).ok).toBe(false);
    expect(validatePublicProfileResponse([]).ok).toBe(false);
  });
});
