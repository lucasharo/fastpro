// #154 (desenho 176, S1 e CA-154-03, 04, 05, 19) | Funcoes puras de entrada-comum.js.
// Roda o script numa maquina virtual (node:vm), como acesso-page.test.ts. Nenhum teste usa rede.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const lerArquivo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

interface Api {
  TEXTOS: Record<string, string>;
  DESTINO_PROFISSIONAL: string;
  emailValido(texto: unknown): boolean;
  motivoSenha(motivo: string): string;
  esperaLimite(retryAfter: string | null): number;
  destinoSeguro(valor: unknown): string | null;
  extrairToken(fragmento: string): string | null;
  opcoesJson(objeto?: unknown): Record<string, unknown>;
  enviarJson(
    buscar: (url: string, opcoes: Record<string, unknown>) => Promise<unknown>,
    caminho: string,
    objeto?: unknown,
  ): Promise<{ status: number; retryAfter: string | null; corpo: unknown }>;
  ocupado(botao: { disabled: boolean }, valor: boolean): void;
  mostrarErro(campo: { attrs: Record<string, string> }, erro: { textContent: string }, texto: string): void;
  limparErro(campo: { attrs: Record<string, string> }, erro: { textContent: string }): void;
}

function carregarApi(): Api {
  const janela: Record<string, unknown> = {};
  vm.runInContext(lerArquivo('../public/entrada-comum.js'), vm.createContext(janela));
  return janela.FastProEntrada as Api;
}

const api = carregarApi();

describe('entrada-comum: e-mail (mesma forma do servidor)', () => {
  it('aceita e-mail com arroba e dominio com ponto', () => {
    expect(api.emailValido('pessoa@exemplo.com.br')).toBe(true);
  });

  it('recusa texto sem arroba, sem dominio, com espaco ou vazio', () => {
    for (const ruim of ['sem-arroba', 'a@b', 'a b@c.d', '', '   ', '@x.com']) {
      expect(api.emailValido(ruim)).toBe(false);
    }
  });

  it('recusa valor que nao e texto', () => {
    expect(api.emailValido(undefined)).toBe(false);
    expect(api.emailValido(42)).toBe(false);
  });
});

describe('entrada-comum: motivos de senha (6 motivos do servidor)', () => {
  it('cada motivo tem texto proprio e nao vazio', () => {
    const motivos = ['tipo', 'curta', 'longa', 'controle', 'igual_email', 'comum'];
    const textos = motivos.map((m) => api.motivoSenha(m));
    for (const t of textos) expect(t.length).toBeGreaterThan(10);
    expect(new Set(textos).size).toBe(motivos.length);
  });

  it('motivo desconhecido ou de chave herdada cai no texto generico', () => {
    expect(api.motivoSenha('inventado')).toBe(api.TEXTOS.motivoSenhaGenerico);
    expect(api.motivoSenha('constructor')).toBe(api.TEXTOS.motivoSenhaGenerico);
    expect(api.motivoSenha('toString')).toBe(api.TEXTOS.motivoSenhaGenerico);
  });
});

describe('entrada-comum: espera depois de 429 (AD-154-08)', () => {
  it('sem cabecalho ou valor invalido usa 30 segundos', () => {
    expect(api.esperaLimite(null)).toBe(30);
    expect(api.esperaLimite('')).toBe(30);
    expect(api.esperaLimite('abc')).toBe(30);
  });

  it('limita entre 5 e 900 segundos', () => {
    expect(api.esperaLimite('2')).toBe(5);
    expect(api.esperaLimite('120')).toBe(120);
    expect(api.esperaLimite('99999')).toBe(900);
  });
});

describe('entrada-comum: destino de retorno (AD-154-07, lista fixa)', () => {
  it('aceita somente os caminhos da lista', () => {
    expect(api.destinoSeguro('/pedido/revisao')).toBe('/pedido/revisao');
    expect(api.destinoSeguro('/pedido')).toBe('/pedido');
    expect(api.destinoSeguro('/')).toBe('/');
  });

  it('recusa caminho externo, protocolo, barra dupla, query e valor fora de texto', () => {
    for (const ruim of [
      '//evil.example',
      'http://evil.example',
      'javascript:alert(1)',
      '/pedido?x=1',
      '/pedido/',
      '/outra',
      '',
    ]) {
      expect(api.destinoSeguro(ruim)).toBeNull();
    }
    expect(api.destinoSeguro(undefined)).toBeNull();
    expect(api.destinoSeguro(['/pedido'])).toBeNull();
  });

  it('o destino do profissional e a constante do desenho (AD-154-02)', () => {
    expect(api.DESTINO_PROFISSIONAL).toBe('/profissional-documentos');
  });
});

describe('entrada-comum: token no fragmento (mesma forma de acesso.js)', () => {
  it('le o token do fragmento, inclusive depois de outro parametro', () => {
    expect(api.extrairToken('#t=ABC_-123')).toBe('ABC_-123');
    expect(api.extrairToken('#x=1&t=ABC')).toBe('ABC');
  });

  it('devolve nulo para fragmento vazio, sem valor, com espaco ou longo demais', () => {
    expect(api.extrairToken('')).toBeNull();
    expect(api.extrairToken(undefined as unknown as string)).toBeNull();
    expect(api.extrairToken('#t=')).toBeNull();
    expect(api.extrairToken('#t=a b')).toBeNull();
    expect(api.extrairToken('#t=' + 'a'.repeat(513))).toBeNull();
  });
});

describe('entrada-comum: opcoes de rede (AD-154-04 e secao 7)', () => {
  it('usa mesma origem, sem cache, sem redirecionamento e sem referrer', () => {
    const o = api.opcoesJson({ email: 'a@b.co' });
    expect(o.method).toBe('POST');
    expect(o.credentials).toBe('same-origin');
    expect(o.cache).toBe('no-store');
    expect(o.redirect).toBe('error');
    expect(o.referrerPolicy).toBe('no-referrer');
    expect(o.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(o.body).toBe('{"email":"a@b.co"}');
  });

  it('sem objeto envia corpo vazio de objeto', () => {
    expect(api.opcoesJson().body).toBe('{}');
  });
});

describe('entrada-comum: enviarJson (resposta sempre normalizada)', () => {
  function respostaFalsa(status: number, retry: string | null, corpo: unknown, comJson = true) {
    return {
      status,
      headers: { get: (nome: string) => (nome === 'Retry-After' ? retry : null) },
      json: comJson
        ? () => (corpo instanceof Error ? Promise.reject(corpo) : Promise.resolve(corpo))
        : undefined,
    };
  }

  it('devolve status, cabecalho Retry-After e corpo JSON', async () => {
    const chamadas: Array<[string, Record<string, unknown>]> = [];
    const r = await api.enviarJson(
      async (url, opcoes) => {
        chamadas.push([url, opcoes]);
        return respostaFalsa(429, '42', { code: 'muitos_pedidos' });
      },
      '/x',
      { email: 'a@b.co' },
    );
    expect(r).toEqual({ status: 429, retryAfter: '42', corpo: { code: 'muitos_pedidos' } });
    expect(chamadas[0][0]).toBe('/x');
    expect(chamadas[0][1].method).toBe('POST');
  });

  it('204 sem corpo nao e erro: corpo nulo e status preservado', async () => {
    const r = await api.enviarJson(async () => respostaFalsa(204, null, new SyntaxError('vazio')), '/x', {});
    expect(r.status).toBe(204);
    expect(r.corpo).toBeNull();
  });

  it('resposta sem metodo json devolve corpo nulo', async () => {
    const r = await api.enviarJson(async () => respostaFalsa(200, null, null, false), '/x', {});
    expect(r.status).toBe(200);
    expect(r.corpo).toBeNull();
  });

  it('falha de rede vira status 0 (indisponivel), sem expor o erro', async () => {
    const r = await api.enviarJson(
      () => Promise.reject(new Error('rede_simulada')),
      '/x',
      {},
    );
    expect(r).toEqual({ status: 0, retryAfter: null, corpo: null });
  });

  it('404 da API ainda nao publicada (Issue 156) chega como status 404, sem excecao', async () => {
    const r = await api.enviarJson(async () => respostaFalsa(404, null, null, false), '/api/v1/x', {});
    expect(r.status).toBe(404);
  });
});

describe('entrada-comum: estado de botao e erro de campo (CA-154-04, CA-154-03)', () => {
  it('ocupado() desabilita e marca aria-busy sem trocar o texto', () => {
    const botao: { disabled: boolean; textContent: string; attrs: Record<string, string>; setAttribute(n: string, v: string): void; removeAttribute(n: string): void } = {
      disabled: false,
      textContent: 'Enviar acesso',
      attrs: {},
      setAttribute(n, v) {
        this.attrs[n] = v;
      },
      removeAttribute(n) {
        delete this.attrs[n];
      },
    };
    api.ocupado(botao, true);
    expect(botao.disabled).toBe(true);
    expect(botao.attrs['aria-busy']).toBe('true');
    expect(botao.textContent).toBe('Enviar acesso');
    api.ocupado(botao, false);
    expect(botao.disabled).toBe(false);
    expect(botao.attrs['aria-busy']).toBeUndefined();
  });

  it('mostrarErro() escreve texto com prefixo "Erro:" e marca o campo como invalido', () => {
    const campo = { attrs: {} as Record<string, string>, setAttribute(n: string, v: string) { this.attrs[n] = v; }, removeAttribute(n: string) { delete this.attrs[n]; } };
    const erro = { textContent: '' };
    api.mostrarErro(campo as never, erro, 'Informe um e-mail válido.');
    expect(erro.textContent).toBe('Erro: Informe um e-mail válido.');
    expect(campo.attrs['aria-invalid']).toBe('true');
    api.limparErro(campo as never, erro);
    expect(erro.textContent).toBe('');
    expect(campo.attrs['aria-invalid']).toBeUndefined();
  });
});

describe('entrada-comum: textos fixos sem jargao', () => {
  it('nenhum texto de tela contem termos tecnicos ou siglas internas', () => {
    const proibidos = /\b(API|token|hash|JSON|HTTP|cookie|sessão|RF-|FA-|RN-|CA-|429|503|422|401|403|410|204|202)\b/;
    for (const [chave, texto] of Object.entries(api.TEXTOS)) {
      expect(proibidos.test(texto), `${chave}: ${texto}`).toBe(false);
    }
  });

  it('nenhum texto menciona login social (CA-154-18, RN-154-08, decisao 956)', () => {
    for (const texto of Object.values(api.TEXTOS)) {
      expect(/Google|Apple/.test(texto)).toBe(false);
    }
  });
});
