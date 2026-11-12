// H-016 | Modelos versionados do profissional (docs/factory/33-DESENHO-H016.md §10). Sem rede, sem envio.
// Confere assunto e corpo, link e prazo obrigatorios, que o aviso de senha nao traz link nem codigo, e que
// erros nao carregam o link. Valores sinteticos.
import { describe, it, expect } from 'vitest';
import {
  createProfessionalAwareRenderer,
  createMinimalRenderer,
  PASSWORD_CHANGED_TEMPLATE,
  PROFESSIONAL_ACTIVATE_TEMPLATE,
  PROFESSIONAL_RECOVERY_TEMPLATE,
  PROFESSIONAL_TEMPLATE_KEYS,
  PROFESSIONAL_TEMPLATE_VERSIONS,
  PROFESSIONAL_VERIFY_TEMPLATE,
  ProfessionalRenderError,
} from '../src/index.js';

const LINK = 'https://app.example.test/profissional/verificar#t=SEGREDO-SINTETICO-0123456789-abcdefghijk';
const PARAMS = { link: LINK, minutos: 15 };

const renderer = createProfessionalAwareRenderer(createMinimalRenderer());

describe('modelos com link (verificacao, recuperacao, ativacao)', () => {
  it.each([
    [PROFESSIONAL_VERIFY_TEMPLATE, 'Confirme seu e-mail no FastPro'],
    [PROFESSIONAL_RECOVERY_TEMPLATE, 'Redefina sua senha do FastPro'],
    [PROFESSIONAL_ACTIVATE_TEMPLATE, 'Confirme para criar seu perfil de profissional no FastPro'],
  ])('%s tem assunto proprio e corpo com link e prazo', (modelo, assunto) => {
    const out = renderer.render(modelo, PARAMS);
    expect(out.subject).toBe(assunto);
    expect(out.text).toContain(LINK);
    expect(out.text).toContain('valido por 15 minutos, uso unico');
    expect(out.text).toContain('ignore-a');
  });

  it('a ativacao deixa claro que a senha de cliente nao muda', () => {
    expect(renderer.render(PROFESSIONAL_ACTIVATE_TEMPLATE, PARAMS).text).toContain('Sua senha de cliente nao muda');
  });

  it('recusa link que nao e https/http, prazo fora de 1 a 60 e prazo nao inteiro', () => {
    const invalidos: Record<string, unknown>[] = [
      { link: 'javascript:alert(1)', minutos: 15 },
      { link: 'nao-e-link', minutos: 15 },
      { link: LINK, minutos: 0 },
      { link: LINK, minutos: 61 },
      { link: LINK, minutos: 1.5 },
      { minutos: 15 },
    ];
    for (const params of invalidos) {
      expect(() => renderer.render(PROFESSIONAL_RECOVERY_TEMPLATE, params)).toThrow(ProfessionalRenderError);
    }
  });

  it('o erro nao carrega o link nem o valor recebido', () => {
    try {
      renderer.render(PROFESSIONAL_RECOVERY_TEMPLATE, { link: 'nao-e-link-SEGREDO-XYZ', minutos: 15 });
      expect.fail('deveria recusar');
    } catch (err) {
      expect(err).toBeInstanceOf(ProfessionalRenderError);
      expect(String((err as Error).message)).not.toContain('SEGREDO-XYZ');
      expect((err as ProfessionalRenderError).code).toBe('parametros_invalidos');
    }
  });
});

describe('aviso de senha alterada (senha_alterada)', () => {
  it('assunto e corpo sem link, codigo ou parametro; orienta quem nao reconhece', () => {
    const out = renderer.render(PASSWORD_CHANGED_TEMPLATE, { link: LINK, minutos: 15 });
    expect(out.subject).toBe('Sua senha do FastPro foi alterada');
    expect(out.text).not.toContain('https://');
    expect(out.text).not.toContain(LINK);
    expect(out.text).toContain('entre em contato com o suporte');
  });
});

describe('versoes e registro', () => {
  it('todo modelo do profissional tem versao inteira positiva', () => {
    expect([...PROFESSIONAL_TEMPLATE_KEYS].sort()).toEqual(
      [PASSWORD_CHANGED_TEMPLATE, PROFESSIONAL_ACTIVATE_TEMPLATE, PROFESSIONAL_RECOVERY_TEMPLATE, PROFESSIONAL_VERIFY_TEMPLATE].sort(),
    );
    for (const chave of PROFESSIONAL_TEMPLATE_KEYS) {
      expect(Number.isInteger(PROFESSIONAL_TEMPLATE_VERSIONS[chave])).toBe(true);
      expect(PROFESSIONAL_TEMPLATE_VERSIONS[chave]).toBeGreaterThan(0);
    }
  });

  it('modelos de outras frentes seguem o renderizador base', () => {
    const base = createMinimalRenderer();
    expect(renderer.render('acesso_login', PARAMS)).toEqual(base.render('acesso_login', PARAMS));
  });
});
