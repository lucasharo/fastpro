// H-037 (#50) | Tela do envio do documento de identidade (docs/factory/107-DESENHO-H037.md §3, §8; CA-20).
// Sem DOM real e sem rede: o controlador recebe um documento falso, uma funcao de API falsa e uma de Storage falsa.
// Confere-se: regras locais de tipo e tamanho (sem chamada), o corpo da emissao sem nome de arquivo, o fluxo
// emitir, PUT e finalizar, a repeticao com o mesmo client_upload_id, o envio duplo bloqueado, o cancelamento,
// a exclusao, a lista, os textos aprovados de cada estado e o foco por script.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-037 (UI)');
};

import { describe, it, expect } from 'vitest';
import {
  EMISSAO_ENDPOINT,
  DOCUMENTOS_ENDPOINT,
  LIMITE_IMAGEM_BYTES,
  LIMITE_PDF_BYTES,
  MENSAGENS,
  corpoEmissao,
  iniciarDocumentos,
  mensagemDeErro,
  rotuloDeTipo,
  tipoDeclarado,
  verificarArquivo,
} from '../public/profissional-documentos.js';

class Elemento {
  value = '';
  textContent = '';
  disabled = false;
  hidden = false;
  foco = 0;
  files: Array<{ type: string; size: number }> = [];
  children: Elemento[] = [];
  private readonly attrs = new Map<string, string>();
  private readonly ouvintes = new Map<string, Array<() => void>>();
  constructor(
    readonly id: string,
    readonly tag: string,
  ) {}
  setAttribute(nome: string, valor: string) {
    this.attrs.set(nome, String(valor));
  }
  getAttribute(nome: string) {
    return this.attrs.get(nome) ?? null;
  }
  removeAttribute(nome: string) {
    this.attrs.delete(nome);
  }
  focus() {
    this.foco += 1;
  }
  addEventListener(tipo: string, fn: () => void) {
    const lista = this.ouvintes.get(tipo) ?? [];
    lista.push(fn);
    this.ouvintes.set(tipo, lista);
  }
  disparar(tipo: string) {
    for (const fn of this.ouvintes.get(tipo) ?? []) fn();
  }
  clicar() {
    this.disparar('click');
  }
  appendChild(filho: Elemento) {
    this.children.push(filho);
    return filho;
  }
  replaceChildren() {
    this.children = [];
  }
}

class Documento {
  private readonly porId = new Map<string, Elemento>();
  constructor() {
    const tags: Array<[string, string]> = [
      ['estado', 'p'],
      ['alerta', 'p'],
      ['arquivo', 'input'],
      ['cancelar', 'button'],
      ['repetir', 'button'],
      ['lista', 'ul'],
      ['titulo-lista', 'h2'],
    ];
    for (const [id, tag] of tags) this.porId.set(id, new Elemento(id, tag));
  }
  getElementById(id: string): Elemento {
    const e = this.porId.get(id);
    if (!e) throw new Error('elemento inexistente: ' + id);
    return e;
  }
  createElement(tag: string): Elemento {
    return new Elemento('', tag);
  }
  el(id: string): Elemento {
    return this.getElementById(id);
  }
}

interface Resp {
  status: number;
  corpo: unknown;
}
interface Chamada {
  metodo: string;
  url: string;
  opcoes: Record<string, unknown>;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function montar(responder: (metodo: string, url: string, opcoes: Record<string, unknown>) => Resp | Promise<Resp>, storage?: (url: string, arquivo: unknown, tipo: string, sinal: AbortSignal) => Promise<{ ok: boolean }>) {
  const doc = new Documento();
  const chamadas: Chamada[] = [];
  const buscar = async (url: string, opcoes: Record<string, unknown>) => {
    const metodo = String(opcoes.method);
    chamadas.push({ metodo, url, opcoes });
    return responder(metodo, url, opcoes);
  };
  const storageDefault = async () => ({ ok: true });
  const armazenados: Array<{ url: string; arquivo: unknown; tipo: string }> = [];
  const enviarAoStorage = async (url: string, arquivo: unknown, tipo: string, sinal: AbortSignal) => {
    armazenados.push({ url, arquivo, tipo });
    return (storage ?? storageDefault)(url, arquivo, tipo, sinal);
  };
  let contador = 0;
  const gerarId = () => 'cid-' + ++contador;
  iniciarDocumentos(doc as unknown as Document, buscar, enviarAoStorage, gerarId);
  const escolher = (arquivo: { type: string; size: number }) => {
    const input = doc.el('arquivo');
    input.files = [arquivo];
    input.disparar('change');
  };
  return { doc, chamadas, armazenados, escolher, gerarId: () => contador };
}

const LISTA_VAZIA: Resp = { status: 200, corpo: { documents: [], slotsRemaining: 5 } };
const JPEG_4MB = { type: 'image/jpeg', size: 4_000_000 };
const RECEBIDO = {
  id: 'd1',
  kind: 'imagem',
  status: 'recebido',
  receivedAt: '2026-11-13T10:00:00Z',
  deletable: true,
};

describe('regras locais de arquivo (sem chamada de rede)', () => {
  it('aceita so os quatro tipos declarados', () => {
    expect(tipoDeclarado({ type: 'image/jpeg', size: 1 })).toBe('image/jpeg');
    expect(tipoDeclarado({ type: 'image/png', size: 1 })).toBe('image/png');
    expect(tipoDeclarado({ type: 'image/webp', size: 1 })).toBe('image/webp');
    expect(tipoDeclarado({ type: 'application/pdf', size: 1 })).toBe('application/pdf');
    for (const tipo of ['image/gif', 'image/heic', 'image/heif', 'image/svg+xml', 'text/html', '']) {
      expect(tipoDeclarado({ type: tipo, size: 1 })).toBeNull();
    }
  });

  it('imagem de 5 MiB passa e 5 MiB + 1 byte e recusada com o texto de imagem', () => {
    expect(verificarArquivo({ type: 'image/jpeg', size: LIMITE_IMAGEM_BYTES })).toEqual({ ok: true, tipo: 'image/jpeg' });
    expect(verificarArquivo({ type: 'image/jpeg', size: LIMITE_IMAGEM_BYTES + 1 })).toEqual({
      ok: false,
      mensagem: MENSAGENS.tamanhoImagem,
    });
  });

  it('PDF de 2 MiB passa e 2 MiB + 1 byte e recusado com o texto de PDF', () => {
    expect(verificarArquivo({ type: 'application/pdf', size: LIMITE_PDF_BYTES })).toEqual({ ok: true, tipo: 'application/pdf' });
    expect(verificarArquivo({ type: 'application/pdf', size: LIMITE_PDF_BYTES + 1 })).toEqual({
      ok: false,
      mensagem: MENSAGENS.tamanhoPdf,
    });
  });

  it('tipo recusado e arquivo vazio nao chegam a API (texto de tipo ou de conteudo)', () => {
    expect(verificarArquivo({ type: 'image/gif', size: 10 })).toEqual({ ok: false, mensagem: MENSAGENS.tipo });
    expect(verificarArquivo({ type: 'image/jpeg', size: 0 })).toEqual({ ok: false, mensagem: MENSAGENS.conteudo });
  });

  it('o corpo da emissao tem so as tres chaves, sem nome de arquivo', () => {
    const corpo = corpoEmissao('cid-x', 'image/png', 1234);
    expect(Object.keys(corpo).sort()).toEqual(['client_upload_id', 'content_type', 'size_bytes']);
    expect(corpo).toEqual({ client_upload_id: 'cid-x', content_type: 'image/png', size_bytes: 1234 });
  });

  it('rotulos e caminhos da API', () => {
    expect(rotuloDeTipo('imagem')).toBe('Foto');
    expect(rotuloDeTipo('pdf')).toBe('PDF');
    expect(EMISSAO_ENDPOINT).toBe('/api/v1/professional/documents/uploads');
    expect(DOCUMENTOS_ENDPOINT).toBe('/api/v1/professional/documents');
  });
});

describe('mensagens por contexto, status e codigo (textos aprovados de 106 §6)', () => {
  it.each([
    ['emissao', 415, 'tipo_nao_aceito', 'image/jpeg', MENSAGENS.tipo],
    ['emissao', 413, 'arquivo_grande', 'application/pdf', MENSAGENS.tamanhoPdf],
    ['emissao', 413, 'arquivo_grande', 'image/png', MENSAGENS.tamanhoImagem],
    ['emissao', 422, 'limite_documentos', 'image/png', MENSAGENS.limite],
    ['finalizacao', 422, 'pdf_protegido', 'application/pdf', MENSAGENS.conteudo],
    ['finalizacao', 422, 'imagem_grande_demais', 'image/jpeg', MENSAGENS.conteudo],
    ['finalizacao', 422, 'nao_cabe_no_limite', 'image/jpeg', MENSAGENS.conteudo],
    ['emissao', 422, 'campo_desconhecido', 'image/jpeg', MENSAGENS.falha],
    ['emissao', 429, 'muitas_tentativas', 'image/jpeg', MENSAGENS.muitas],
    ['lista', 401, 'nao_autenticado', null, MENSAGENS.sessao],
    ['emissao', 403, 'email_nao_verificado', null, MENSAGENS.falha],
    ['emissao', 403, 'estado_perfil', null, MENSAGENS.estadoPerfil],
    ['exclusao', 409, 'ja_analisado', null, MENSAGENS.falha],
    ['lista', 404, 'nao_encontrado', null, MENSAGENS.falha],
    ['finalizacao', 409, 'upload_expirado', 'image/jpeg', MENSAGENS.falha],
    ['envio', 503, 'servico_indisponivel', 'image/jpeg', MENSAGENS.falha],
  ] as const)('%s %i %s', (contexto, status, codigo, tipo, esperado) => {
    expect(mensagemDeErro(contexto, status, codigo, tipo)).toBe(esperado);
  });
});

describe('fluxo de envio (emitir, PUT ao Storage, finalizar)', () => {
  it('envio feliz: recebido, lista atualizada, foco na lista e nenhum nome de arquivo na API', async () => {
    let lista: Resp = LISTA_VAZIA;
    const { doc, chamadas, armazenados, escolher } = montar(async (metodo, url) => {
      if (metodo === 'GET') return lista;
      if (metodo === 'POST' && url === EMISSAO_ENDPOINT) {
        return { status: 201, corpo: { id: 'd1', status: 'em_envio', upload_url: 'https://storage.test/u/1', upload_expires_at: 'x' } };
      }
      if (metodo === 'POST' && url.endsWith('/d1/finalize')) return { status: 200, corpo: { id: 'd1', status: 'recebido', kind: 'imagem' } };
      throw new Error('chamada inesperada ' + metodo + ' ' + url);
    });
    await tick();
    expect(doc.el('estado').textContent).toBe(MENSAGENS.vazio);
    lista = { status: 200, corpo: { documents: [RECEBIDO], slotsRemaining: 4 } };
    escolher(JPEG_4MB);
    await tick();
    expect(chamadas.map((c) => c.metodo + ' ' + c.url)).toEqual([
      'GET ' + DOCUMENTOS_ENDPOINT,
      'POST ' + EMISSAO_ENDPOINT,
      'POST ' + DOCUMENTOS_ENDPOINT + '/d1/finalize',
      'GET ' + DOCUMENTOS_ENDPOINT,
    ]);
    const emissao = chamadas[1];
    expect(emissao.opcoes.body).toBe(JSON.stringify({ client_upload_id: 'cid-1', content_type: 'image/jpeg', size_bytes: 4_000_000 }));
    expect(String(emissao.opcoes.body)).not.toMatch(/name|filename|rg-|\.jpg/i);
    expect(armazenados).toHaveLength(1);
    expect(armazenados[0]).toMatchObject({ url: 'https://storage.test/u/1', tipo: 'image/jpeg' });
    expect(doc.el('estado').textContent).toBe(MENSAGENS.recebido);
    expect(doc.el('alerta').textContent).toBe('');
    expect(doc.el('titulo-lista').foco).toBe(1);
    expect(doc.el('lista').children).toHaveLength(1);
    expect(doc.el('lista').children[0].textContent).toBe('Foto · recebido em ' + new Date(RECEBIDO.receivedAt).toLocaleDateString('pt-BR'));
    expect(doc.el('arquivo').disabled).toBe(false);
    expect(doc.el('cancelar').hidden).toBe(true);
  });

  it('resposta 200 sem URL (envio ja recebido) atualiza a lista e nao envia ao Storage nem finaliza', async () => {
    const { doc, chamadas, armazenados, escolher } = montar(async (metodo, url) => {
      if (metodo === 'GET') return { status: 200, corpo: { documents: [RECEBIDO], slotsRemaining: 4 } };
      if (metodo === 'POST') return { status: 200, corpo: { id: 'd1', status: 'recebido' } };
      throw new Error('inesperado ' + url);
    });
    await tick();
    escolher(JPEG_4MB);
    await tick();
    expect(armazenados).toHaveLength(0);
    expect(chamadas.some((c) => c.url.endsWith('/finalize'))).toBe(false);
    expect(doc.el('estado').textContent).toBe(MENSAGENS.recebido);
  });

  it('falha no PUT mostra o texto de falha, oferece repetir e reenvia com o MESMO client_upload_id', async () => {
    let tentativasPut = 0;
    const { doc, chamadas, escolher, gerarId } = montar(
      async (metodo, url) => {
        if (metodo === 'GET') return LISTA_VAZIA;
        if (metodo === 'POST' && url === EMISSAO_ENDPOINT) {
          return { status: 201, corpo: { id: 'd1', status: 'em_envio', upload_url: 'https://storage.test/u/1', upload_expires_at: 'x' } };
        }
        if (metodo === 'POST' && url.endsWith('/finalize')) return { status: 200, corpo: { id: 'd1', status: 'recebido', kind: 'imagem' } };
        throw new Error('inesperado ' + url);
      },
      async () => {
        tentativasPut += 1;
        return { ok: tentativasPut > 1 };
      },
    );
    await tick();
    escolher(JPEG_4MB);
    await tick();
    expect(doc.el('alerta').textContent).toBe(MENSAGENS.falha);
    expect(doc.el('repetir').hidden).toBe(false);
    expect(doc.el('repetir').foco).toBe(1);
    expect(gerarId()).toBe(1);
    doc.el('repetir').clicar();
    await tick();
    const emissoes = chamadas.filter((c) => c.url === EMISSAO_ENDPOINT);
    expect(emissoes).toHaveLength(2);
    expect(JSON.parse(String(emissoes[0].opcoes.body)).client_upload_id).toBe('cid-1');
    expect(JSON.parse(String(emissoes[1].opcoes.body)).client_upload_id).toBe('cid-1');
    expect(gerarId()).toBe(1);
    expect(doc.el('estado').textContent).toBe(MENSAGENS.recebido);
    expect(doc.el('repetir').hidden).toBe(true);
  });

  it('envio duplo fica bloqueado enquanto a resposta nao chega (uma unica emissao)', async () => {
    let liberar: (() => void) | null = null;
    const { doc, chamadas, escolher } = montar(
      (metodo, url) => {
        if (metodo === 'GET') return LISTA_VAZIA;
        if (metodo === 'POST' && url === EMISSAO_ENDPOINT) {
          return new Promise<Resp>((resolver) => {
            liberar = () => resolver({ status: 200, corpo: { id: 'd1', status: 'recebido' } });
          });
        }
        throw new Error('inesperado ' + url);
      },
    );
    await tick();
    escolher(JPEG_4MB);
    escolher(JPEG_4MB);
    expect(doc.el('arquivo').disabled).toBe(true);
    expect(chamadas.filter((c) => c.url === EMISSAO_ENDPOINT)).toHaveLength(1);
    (liberar as unknown as () => void)();
    await tick();
    expect(chamadas.filter((c) => c.url === EMISSAO_ENDPOINT)).toHaveLength(1);
  });

  it('cancelar aborta o envio, nao finaliza, volta ao vazio e devolve o foco ao campo de arquivo', async () => {
    const { doc, chamadas, escolher } = montar(
      async (metodo, url) => {
        if (metodo === 'GET') return LISTA_VAZIA;
        if (metodo === 'POST' && url === EMISSAO_ENDPOINT) {
          return { status: 201, corpo: { id: 'd1', status: 'em_envio', upload_url: 'https://storage.test/u/1', upload_expires_at: 'x' } };
        }
        throw new Error('inesperado ' + url);
      },
      (_url, _arquivo, _tipo, sinal) =>
        new Promise((_resolver, rejeitar) => {
          sinal.addEventListener('abort', () => rejeitar(new Error('AbortError')));
        }),
    );
    await tick();
    escolher(JPEG_4MB);
    await tick();
    expect(doc.el('cancelar').hidden).toBe(false);
    doc.el('cancelar').clicar();
    await tick();
    expect(chamadas.some((c) => c.url.endsWith('/finalize'))).toBe(false);
    expect(doc.el('estado').textContent).toBe(MENSAGENS.vazio);
    expect(doc.el('alerta').textContent).toBe('');
    expect(doc.el('cancelar').hidden).toBe(true);
    expect(doc.el('arquivo').foco).toBe(1);
  });

  it('arquivo recusado no navegador nao gera nenhuma chamada e mostra o texto de PDF grande', async () => {
    const { doc, chamadas, escolher } = montar(async () => {
      throw new Error('nao deveria chamar a API');
    });
    await tick();
    const antes = chamadas.length;
    escolher({ type: 'application/pdf', size: LIMITE_PDF_BYTES + 1 });
    await tick();
    expect(chamadas).toHaveLength(antes);
    expect(doc.el('alerta').textContent).toBe(MENSAGENS.tamanhoPdf);
    expect(doc.el('arquivo').foco).toBe(1);
  });

  it('429 na emissao mostra o texto de muitas tentativas, sem numero', async () => {
    const { doc, escolher } = montar(async (metodo) => {
      if (metodo === 'GET') return LISTA_VAZIA;
      return { status: 429, corpo: { code: 'muitas_tentativas' } };
    });
    await tick();
    escolher(JPEG_4MB);
    await tick();
    expect(doc.el('alerta').textContent).toBe(MENSAGENS.muitas);
    expect(doc.el('alerta').textContent).not.toMatch(/\d/);
  });

  it('lista com 401 mostra o texto de sessao e nao exibe documentos', async () => {
    const { doc } = montar(async () => ({ status: 401, corpo: { code: 'nao_autenticado' } }));
    await tick();
    expect(doc.el('alerta').textContent).toBe(MENSAGENS.sessao);
    expect(doc.el('lista').children).toHaveLength(0);
  });
});

describe('lista e exclusao do dono', () => {
  it('mostra Excluir so nos itens que podem ser excluidos; estado vazio quando nao ha nada', async () => {
    const { doc } = montar(async () => ({
      status: 200,
      corpo: {
        documents: [RECEBIDO, { id: 'd2', kind: 'pdf', status: 'recebido', receivedAt: '2026-11-13T10:00:00Z', deletable: false }],
        slotsRemaining: 3,
      },
    }));
    await tick();
    const [primeiro, segundo] = doc.el('lista').children;
    expect(primeiro.children.map((c) => c.textContent)).toEqual(['Excluir']);
    expect(segundo.children).toHaveLength(0);
    expect(segundo.textContent.startsWith('PDF')).toBe(true);
    expect(doc.el('estado').textContent).toBe('');
  });

  it('exclusao com 204 recarrega a lista, avisa e devolve o foco ao titulo da lista', async () => {
    let lista: Resp = { status: 200, corpo: { documents: [RECEBIDO], slotsRemaining: 4 } };
    const { doc, chamadas } = montar(async (metodo, url) => {
      if (metodo === 'DELETE') return { status: 204, corpo: null };
      if (metodo === 'GET') return lista;
      throw new Error('inesperado ' + url);
    });
    await tick();
    lista = LISTA_VAZIA;
    doc.el('lista').children[0].children[0].clicar();
    await tick();
    expect(chamadas.map((c) => c.metodo)).toEqual(['GET', 'DELETE', 'GET']);
    expect(chamadas[1].url).toBe(DOCUMENTOS_ENDPOINT + '/d1');
    expect(doc.el('estado').textContent).toBe('');
    expect(doc.el('titulo-lista').foco).toBe(1);
  });

  it('exclusao de item ja analisado (409) mostra a falha generica (sem texto aprovado) e foca o alerta', async () => {
    const { doc } = montar(async (metodo) => {
      if (metodo === 'GET') return { status: 200, corpo: { documents: [RECEBIDO], slotsRemaining: 4 } };
      return { status: 409, corpo: { code: 'ja_analisado' } };
    });
    await tick();
    doc.el('lista').children[0].children[0].clicar();
    await tick();
    expect(doc.el('alerta').textContent).toBe(MENSAGENS.falha);
    expect(doc.el('alerta').foco).toBe(1);
  });
});
