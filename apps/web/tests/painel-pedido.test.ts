// Detalhe do pedido do cliente (/painel/pedido) e link dos cartoes de "Meus pedidos".
import { describe, expect, it } from 'vitest';
import { camposDoDetalhe, idDaBusca, iniciarDetalhe, TEXTOS_DETALHE } from '../public/painel-pedido.js';
import { linkDoItem } from '../public/painel.js';

const ID = '3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f';

class El {
  textContent = '';
  hidden = false;
  attrs: Record<string, string> = {};
  previousElementSibling: El | null = null;
  ouvintes: Array<() => unknown> = [];
  focado = false;
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  addEventListener(_t: string, fn: () => unknown) {
    this.ouvintes.push(fn);
  }
  focus() {
    this.focado = true;
  }
}

function documento() {
  const ids = ['conteudo', 'estado', 'erro-geral', 'tentar', 'detalhe', 'titulo', 'd-status', 'd-prazo', 'd-publicado',
    'd-urgencia', 'd-descricao', 'd-endereco', 'd-cobertura'];
  const els = Object.fromEntries(ids.map((i) => [i, new El()])) as Record<string, El>;
  els['d-cobertura']!.previousElementSibling = new El();
  els['detalhe']!.hidden = true;
  els['tentar']!.hidden = true;
  return { els, doc: { getElementById: (i: string) => els[i] ?? null } };
}

const resposta = (status: number, corpo?: unknown) => ({ status, json: async () => corpo });

describe('linkDoItem', () => {
  it('id uuid vira link do detalhe; sem id ou id estranho, sem link', () => {
    expect(linkDoItem({ id: ID })).toBe(`/painel/pedido?id=${ID}`);
    expect(linkDoItem({ id: '../x' })).toBeNull();
    expect(linkDoItem({})).toBeNull();
  });
});

describe('idDaBusca', () => {
  it('so aceita uuid', () => {
    expect(idDaBusca(`?id=${ID}`)).toBe(ID);
    expect(idDaBusca('?id=abc')).toBeNull();
    expect(idDaBusca('')).toBeNull();
  });
});

describe('camposDoDetalhe', () => {
  it('rotulos em portugues e valores fora do vocabulario nunca aparecem crus', () => {
    const c = camposDoDetalhe(
      {
        serviceName: 'Eletricista residencial',
        status: 'publicado',
        urgency: 'imediato',
        description: 'Tomada sem energia',
        addressText: 'Avenida Paulista 1000, São Paulo - São Paulo',
        publishedAt: '2026-11-22T20:56:34Z',
        acceptanceDeadlineAt: '2026-11-23T20:56:34Z',
        cobertura: 'sem',
      },
      new Date('2026-11-22T21:00:00Z'),
    );
    expect(c.titulo).toBe('Eletricista residencial');
    expect(c.status).toBe('Publicado');
    expect(c.urgencia).toBe('Imediato');
    expect(c.prazo.startsWith(TEXTOS_DETALHE.abertos)).toBe(true);
    expect(c.cobertura).toBe(TEXTOS_DETALHE.coberturaSem);
    const estranho = camposDoDetalhe({ status: 'xyz', urgency: 'abc', acceptanceDeadlineAt: '2020-01-01T00:00:00Z' });
    expect(estranho.status).toBe(TEXTOS_DETALHE.naoInformado);
    expect(estranho.urgencia).toBe(TEXTOS_DETALHE.naoInformado);
    expect(estranho.prazo).toBe(TEXTOS_DETALHE.encerrados);
    expect(estranho.cobertura).toBeNull();
  });
});

describe('iniciarDetalhe', () => {
  it('200 preenche o detalhe e chama a API do proprio pedido', async () => {
    const { els, doc } = documento();
    const urls: string[] = [];
    await iniciarDetalhe({
      doc,
      busca: `?id=${ID}`,
      fetchFn: async (url: string) => {
        urls.push(url);
        return resposta(200, { serviceName: 'Eletricista residencial', status: 'publicado', cobertura: null });
      },
      navegar: () => undefined,
    });
    expect(urls).toEqual([`/api/v1/requests/${ID}`]);
    expect(els['titulo']!.textContent).toBe('Eletricista residencial');
    expect(els['detalhe']!.hidden).toBe(false);
    expect(els['d-cobertura']!.hidden).toBe(true);
    expect(els['tentar']!.hidden).toBe(true);
  });

  it('404: pedido nao encontrado, sem Tentar de novo', async () => {
    const { els, doc } = documento();
    await iniciarDetalhe({ doc, busca: `?id=${ID}`, fetchFn: async () => resposta(404), navegar: () => undefined });
    expect(els['erro-geral']!.textContent).toBe(TEXTOS_DETALHE.naoEncontrado);
    expect(els['tentar']!.hidden).toBe(true);
    expect(els['detalhe']!.hidden).toBe(true);
  });

  it('503 mostra Tentar de novo; 401 manda para a entrada com volta ao painel', async () => {
    const a = documento();
    await iniciarDetalhe({ doc: a.doc, busca: `?id=${ID}`, fetchFn: async () => resposta(503), navegar: () => undefined });
    expect(a.els['erro-geral']!.textContent).toBe(TEXTOS_DETALHE.erro);
    expect(a.els['tentar']!.hidden).toBe(false);

    const b = documento();
    const destinos: string[] = [];
    await iniciarDetalhe({
      doc: b.doc,
      busca: `?id=${ID}`,
      fetchFn: async () => resposta(401),
      navegar: (c: string) => destinos.push(c),
    });
    expect(destinos).toEqual(['/entrar?voltar=%2Fpainel']);
  });

  it('id invalido na URL: nao chama a API', async () => {
    const { els, doc } = documento();
    let chamou = false;
    await iniciarDetalhe({
      doc,
      busca: '?id=nada',
      fetchFn: async () => {
        chamou = true;
        return resposta(200, {});
      },
      navegar: () => undefined,
    });
    expect(chamou).toBe(false);
    expect(els['erro-geral']!.textContent).toBe(TEXTOS_DETALHE.naoEncontrado);
  });
});
