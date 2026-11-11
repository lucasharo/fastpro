// H-012 | T-H012-30 (carregar nao chama API; fragmento sai da URL; sem armazenamento),
// T-H012-31 (clique: um POST so com {token}), T-H012-32 (pagina estatica e cabecalhos do desenho),
// T-H012-33 (sem generateLink/verifyOtp no consumo), T-H012-34 (sem rede; sem clique, sem POST).
// O script roda numa maquina virtual com DOM simulado. Fetch bloqueado; nenhum teste usa rede.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-012');
};

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ACESSO_PAGE_HEADERS } from '@fastpro/domain';

const TOKEN = 'TOKEN-SINTETICO-' + 'p'.repeat(28);
const lerArquivo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

interface Clique {
  disparar(): void;
}

interface Mundo {
  botao: { id: string; disabled: boolean; textContent: string } & Clique;
  aviso: { id: string; disabled: boolean; textContent: string };
  chamadas: {
    fetch: Array<[string, Record<string, unknown>]>;
    replace: string[];
    armazenou: string[];
    timers: Array<[() => void, number]>;
  };
}

/** Monta o DOM simulado, roda o script e devolve o que ele fez. respostaStatus 'erro' = rede. */
function carregar(
  hash: string,
  respostaStatus: number | 'erro' = 200,
  respostaSessao?: number,
): Mundo {
  const listeners: Array<() => void> = [];
  const botao = {
    id: 'confirmar',
    disabled: false,
    textContent: '',
    addEventListener(_tipo: string, fn: () => void) {
      listeners.push(fn);
    },
    disparar() {
      for (const fn of listeners) fn();
    },
  };
  const aviso = { id: 'aviso', disabled: false, textContent: '' };
  const chamadas: Mundo['chamadas'] = { fetch: [], replace: [], armazenou: [], timers: [] };

  const documento = {
    getElementById: (id: string) => (id === 'confirmar' ? botao : id === 'aviso' ? aviso : null),
  };
  Object.defineProperty(documento, 'cookie', {
    set() {
      chamadas.armazenou.push('cookie');
    },
  });

  const janela: Record<string, unknown> = {
    document: documento,
    location: { hash },
    history: {
      replaceState(_estado: unknown, _titulo: string, url: string) {
        chamadas.replace.push(url);
      },
    },
    fetch(url: string, opcoes: Record<string, unknown>) {
      chamadas.fetch.push([url, opcoes]);
      if (respostaStatus === 'erro') return Promise.reject(new Error('rede_simulada'));
      if (url === '/api/v1/auth/session' && respostaSessao !== undefined) {
        return Promise.resolve({ status: respostaSessao });
      }
      return Promise.resolve({ status: respostaStatus });
    },
    setTimeout(fn: () => void, ms: number) {
      chamadas.timers.push([fn, ms]);
    },
    localStorage: { setItem: () => chamadas.armazenou.push('localStorage') },
    sessionStorage: { setItem: () => chamadas.armazenou.push('sessionStorage') },
  };
  janela.window = janela;

  vm.runInContext(lerArquivo('../public/acesso.js'), vm.createContext(janela));
  return { botao, aviso, chamadas };
}

const esperarMicrotarefas = () => new Promise((resolve) => setImmediate(resolve));

describe('T-H012-30 carregar a pagina nao consome nem armazena nada', () => {
  it('com fragmento: nenhuma chamada ao carregar, URL sem o token, nada armazenado', () => {
    const { botao, chamadas } = carregar(`#t=${TOKEN}`);
    expect(chamadas.fetch).toHaveLength(0);
    expect(chamadas.replace).toEqual(['/acesso']);
    expect(chamadas.armazenou).toEqual([]);
    expect(botao.disabled).toBe(true);
    expect(chamadas.timers.map(([, ms]) => ms)).toEqual([1000]);
  });

  it('o botao so habilita depois da espera; o clique continua sendo o unico gatilho', () => {
    const { botao, chamadas } = carregar(`#t=${TOKEN}`);
    chamadas.timers[0]?.[0]();
    expect(botao.disabled).toBe(false);
    expect(chamadas.fetch).toHaveLength(0);
  });

  it('sem fragmento: texto de link invalido, sem chamada e botao desligado', () => {
    const { botao, aviso, chamadas } = carregar('');
    expect(chamadas.fetch).toHaveLength(0);
    expect(aviso.textContent).toBe('Este link não pode mais ser usado. Peça um novo acesso.');
    expect(botao.disabled).toBe(true);
  });

  it('le o token do fragmento mesmo com outros parametros', () => {
    const { botao, chamadas } = carregar(`#x=1&t=${TOKEN}`);
    botao.disparar();
    expect(chamadas.fetch).toHaveLength(1);
    expect(JSON.parse(String(chamadas.fetch[0]?.[1].body))).toEqual({ token: TOKEN });
  });
});

describe('T-H012-31 clique: um POST, so com o token', () => {
  it('envia POST JSON com {token} e nada mais, sem cache, sem referrer e sem redirecionamento', async () => {
    const { botao, chamadas } = carregar(`#t=${TOKEN}`, 200);
    botao.disparar();
    expect(chamadas.fetch).toHaveLength(1);
    const [url, opcoes] = chamadas.fetch[0] ?? ['', {}];
    expect(url).toBe('/api/v1/auth/challenges/consume');
    expect(opcoes.method).toBe('POST');
    expect(opcoes.body).toBe(JSON.stringify({ token: TOKEN }));
    expect(opcoes.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(opcoes.referrerPolicy).toBe('no-referrer');
    expect(opcoes.cache).toBe('no-store');
    expect(opcoes.redirect).toBe('error');
    await esperarMicrotarefas();
  });

  it('duplo clique nao envia duas vezes, e depois da resposta o token nao volta a ser enviado', async () => {
    const { botao, chamadas } = carregar(`#t=${TOKEN}`, 400);
    botao.disparar();
    botao.disparar();
    botao.disparar();
    await esperarMicrotarefas();
    expect(chamadas.fetch).toHaveLength(1);
  });

  it.each([
    [200, 'Acesso confirmado. A próxima etapa será liberada em breve.'],
    [400, 'Este link não pode mais ser usado. Peça um novo acesso.'],
    [503, 'Não foi possível concluir o acesso agora. Peça um novo acesso em alguns minutos.'],
    [403, 'Não foi possível concluir o acesso. Peça um novo acesso.'],
    [422, 'Não foi possível concluir o acesso. Peça um novo acesso.'],
    ['erro', 'Não foi possível concluir o acesso. Peça um novo acesso.'],
  ] as const)('resposta %s mostra o texto previsto', async (status, texto) => {
    const { botao, aviso } = carregar(`#t=${TOKEN}`, status);
    botao.disparar();
    await esperarMicrotarefas();
    expect(aviso.textContent).toBe(texto);
  });
});

describe('T-H012-32 pagina estatica e cabecalhos do desenho', () => {
  it('HTML sem script inline e sem origem externa: so /acesso.js, permitido pela CSP', () => {
    const html = lerArquivo('../public/acesso.html');
    expect(html).toContain('<script src="/acesso.js"></script>');
    expect(/<script(?![^>]*\ssrc=)/.test(html)).toBe(false);
    expect(/https?:\/\//.test(html)).toBe(false);
    expect(/\son[a-z]+=/i.test(html)).toBe(false);
  });

  it('o script nao contem origem externa nem acesso a armazenamento persistente', () => {
    // Compara so o codigo: os comentarios do script descrevem o que ele NAO faz.
    const js = lerArquivo('../public/acesso.js').replace(/\/\/.*$/gm, '');
    expect(/https?:\/\//.test(js)).toBe(false);
    expect(js).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  it('vercel.json: /acesso traz os cabecalhos de 46 §5 (exceto Content-Type)', () => {
    const cfg = JSON.parse(lerArquivo('../vercel.json')) as {
      cleanUrls?: boolean;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    // /acesso serve acesso.html sem extensao (I-2), e o cabecalho vale para esse caminho.
    expect(cfg.cleanUrls).toBe(true);
    const bloco = cfg.headers.find((h) => h.source === '/acesso');
    expect(bloco).toBeDefined();
    const mapa = Object.fromEntries((bloco?.headers ?? []).map((h) => [h.key, h.value]));
    for (const [chave, valor] of Object.entries(ACESSO_PAGE_HEADERS)) {
      if (chave === 'Content-Type') continue;
      expect(mapa[chave], chave).toBe(valor);
    }
  });
});

describe('T-H012-33 o consumo nao aciona geracao nem verificacao de sessao (so H-014)', () => {
  it('nenhum arquivo do consumo chama generateLink ou verifyOtp', () => {
    const arquivos = [
      '../../../packages/db/src/challenge-consume.ts',
      '../../../packages/domain/src/identity/consume.ts',
      '../../../apps/api/src/consume-route.ts',
      '../public/acesso.js',
    ];
    for (const caminho of arquivos) {
      expect(lerArquivo(caminho), caminho).not.toMatch(/generateLink|verifyOtp/);
    }
  });
});

describe('T-H014 pagina /acesso converte a etapa em sessao apos o consumo', () => {
  it('consumo 200: chama POST /v1/auth/session com {} e mesma origem, sem novo clique', async () => {
    const { botao, chamadas, aviso } = carregar(`#t=${TOKEN}`, 200, 200);
    botao.disparar();
    await esperarMicrotarefas();
    expect(chamadas.fetch.map(([u]) => u)).toEqual([
      '/api/v1/auth/challenges/consume',
      '/api/v1/auth/session',
    ]);
    const sessao = chamadas.fetch[1]?.[1] ?? {};
    expect(sessao.method).toBe('POST');
    expect(sessao.body).toBe('{}');
    expect(sessao.credentials).toBe('same-origin');
    expect(sessao.redirect).toBe('error');
    expect(aviso.textContent).toBe('Acesso confirmado. A próxima etapa será liberada em breve.');
  });

  it('consumo negado (400): nenhuma chamada de sessao', async () => {
    const { botao, chamadas } = carregar(`#t=${TOKEN}`, 400);
    botao.disparar();
    await esperarMicrotarefas();
    expect(chamadas.fetch.map(([u]) => u)).toEqual(['/api/v1/auth/challenges/consume']);
  });

  it.each([
    [401, 'Este link não pode mais ser usado. Peça um novo acesso.'],
    [503, 'Não foi possível concluir o acesso agora. Peça um novo acesso em alguns minutos.'],
    [500, 'Não foi possível concluir o acesso. Peça um novo acesso.'],
  ] as const)('sessao respondeu %s: mensagem prevista, sem cookie no script', async (status, texto) => {
    const { botao, aviso, chamadas } = carregar(`#t=${TOKEN}`, 200, status);
    botao.disparar();
    await esperarMicrotarefas();
    expect(aviso.textContent).toBe(texto);
    expect(chamadas.armazenou).toEqual([]);
  });
});
