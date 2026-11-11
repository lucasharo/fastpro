// H-011 | T-H011-04 (renderizador do acesso) e T-H011-37 (conteudo do e-mail). Sem rede, sem envio.
import { describe, it, expect } from 'vitest';
import {
  ACCESS_SUBJECT,
  AuthRenderError,
  createAuthAwareRenderer,
  createMinimalRenderer,
} from '../src/index.js';

const PARAMS = {
  link: 'https://app.example.test/acesso#t=TOKEN-SINTETICO-0123456789',
  code: '482913',
  minutos: 15,
};

describe('T-H011-04 renderizador de acesso_login', () => {
  const renderer = createAuthAwareRenderer(createMinimalRenderer());

  it('assunto generico e corpo com link, codigo, prazo e orientacao', () => {
    const out = renderer.render('acesso_login', PARAMS);
    expect(out.subject).toBe(ACCESS_SUBJECT);
    expect(out.text).toContain(PARAMS.link);
    expect(out.text).toContain('482913');
    expect(out.text).toContain('15 minutos');
    expect(out.text).toContain('ignore esta mensagem');
  });

  it('o corpo nao contem nada alem do que o desafio envia (sem nome, endereco ou cadastro)', () => {
    const out = renderer.render('acesso_login', {
      ...PARAMS,
      nome: 'Fulano',
      email: 'x@example.test',
    });
    expect(out.text.includes('Fulano')).toBe(false);
    expect(out.text.includes('x@example.test')).toBe(false);
    expect(out.text.toLowerCase().includes('cadastro')).toBe(false);
    expect(out.text.toLowerCase().includes('conta')).toBe(false);
  });

  it('parametros fora do formato recusam sem devolver os valores', () => {
    const casos = [
      { ...PARAMS, code: '12345' },
      { ...PARAMS, link: 'javascript:alert(1)' },
      { ...PARAMS, minutos: 0 },
      { link: PARAMS.link, code: PARAMS.code },
    ];
    for (const caso of casos) {
      let erro: unknown = null;
      try {
        renderer.render('acesso_login', caso);
      } catch (err) {
        erro = err;
      }
      expect(erro).toBeInstanceOf(AuthRenderError);
      expect((erro as Error).message).toBe('parametros_invalidos');
      expect((erro as Error).message.includes(String(caso.code ?? ''))).toBe(false);
    }
  });

  it('outros modelos seguem o renderizador base', () => {
    const base = createMinimalRenderer();
    expect(renderer.render('outro_modelo', { x: 1 })).toEqual(
      base.render('outro_modelo', { x: 1 }),
    );
  });
});
