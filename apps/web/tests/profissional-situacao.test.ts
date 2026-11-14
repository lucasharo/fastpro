// Issue 54 (H-041) | Renderizador da situacao do profissional (CA-H041-12, CA-H041-14, CA-H041-15; T41-12, T41-14, T41-15).
// Sem navegador: o script classico e avaliado sobre um DOM falso que registra cada elemento criado.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TODAS_AS_FRASES, construirTela, type TelaVerificacao } from '@fastpro/domain';

const CAMINHO = fileURLToPath(new URL('../public/profissional-situacao.js', import.meta.url));
const FONTE = readFileSync(CAMINHO, 'utf8');

class NoFalso {
  readonly filhos: NoFalso[] = [];
  readonly atributos: Record<string, string> = {};
  textContent = '';
  className = '';
  disabled = false;
  constructor(readonly tag: string, readonly ownerDocument: DocFalso) {}
  appendChild(no: NoFalso): NoFalso {
    this.filhos.push(no);
    return no;
  }
  removeChild(no: NoFalso): NoFalso {
    this.filhos.splice(this.filhos.indexOf(no), 1);
    return no;
  }
  get firstChild(): NoFalso | undefined {
    return this.filhos[0];
  }
  setAttribute(nome: string, valor: string): void {
    this.atributos[nome] = valor;
  }
}

class DocFalso {
  criados: NoFalso[] = [];
  createElement(tag: string): NoFalso {
    const no = new NoFalso(tag, this);
    this.criados.push(no);
    return no;
  }
}

/** Avalia o script classico e devolve a funcao, como o navegador faria. */
function carregarRenderizador(): (raiz: NoFalso, tela: TelaVerificacao) => NoFalso {
  return new Function(`${FONTE}\nreturn renderizarSituacao;`)() as (raiz: NoFalso, tela: TelaVerificacao) => NoFalso;
}

function todosOsTextos(no: NoFalso): string {
  return [no.textContent, ...no.filhos.map(todosOsTextos)].join(' ');
}

describe('renderizador da situacao do profissional (Issue 54, H-041)', () => {
  it('T41-14 | o script nao tem frase propria: nenhuma frase da tabela aparece no codigo-fonte', () => {
    for (const frase of TODAS_AS_FRASES) expect(FONTE, frase).not.toContain(frase);
  });

  it('CA-H041-12 | nunca usa innerHTML, outerHTML ou insercao de HTML; so textContent', () => {
    const codigo = FONTE.split('\n').filter((linha) => !linha.trim().startsWith('//')).join('\n');
    expect(codigo).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    expect(codigo).toContain('textContent');
  });

  it('CA-H041-12 | explicacao com marcacao HTML vira texto puro, sem elemento criado a partir dela', () => {
    const doc = new DocFalso();
    const raiz = new NoFalso('div', doc);
    const tela = construirTela({
      tipo: 'estado',
      estado: { estado: 'recusada', motivo: 'outro', explicacao: '<script>alert(1)</script>', recurso: { situacao: 'indisponivel' } },
    });
    carregarRenderizador()(raiz, tela);
    const explicacao = raiz.filhos.find((n) => n.className === 'situacao-explicacao')!;
    const trecho = explicacao.filhos[1]!;
    expect(trecho.textContent).toBe(' <script>alert(1)</script>');
    expect(trecho.filhos).toHaveLength(0);
    expect(doc.criados.some((n) => n.tag === 'script')).toBe(false);
  });

  it('CA-H041-15 | a regiao anuncia mudancas (aria-live) e o botao traz rotulo, tipo e destino', () => {
    const doc = new DocFalso();
    const raiz = new NoFalso('div', doc);
    const tela = construirTela({ tipo: 'estado', estado: { estado: 'recusada', motivo: 'outro', explicacao: 'x', recurso: { situacao: 'disponivel' } } });
    carregarRenderizador()(raiz, tela);
    expect(raiz.atributos['aria-live']).toBe('polite');
    expect(raiz.atributos['data-estado']).toBe('recusada');
    const botao = doc.criados.find((n) => n.tag === 'button')!;
    expect(botao.textContent).toBe('Pedir revisão');
    expect(botao.atributos.type).toBe('button');
    expect(botao.atributos['data-destino']).toBe('recurso');
    expect(botao.disabled).toBe(false);
  });

  it('CA-H041-15 | recurso recebido: botao desabilitado e aviso visivel no texto', () => {
    const doc = new DocFalso();
    const raiz = new NoFalso('div', doc);
    const tela = construirTela({ tipo: 'estado', estado: { estado: 'recusada', motivo: 'outro', explicacao: 'x', recurso: { situacao: 'recebido' } } });
    carregarRenderizador()(raiz, tela);
    const botao = doc.criados.find((n) => n.tag === 'button')!;
    expect(botao.disabled).toBe(true);
    expect(todosOsTextos(raiz)).toContain('Seu pedido de revisão foi recebido.');
  });

  it('T41-14 | os nove estados de tela renderizam o titulo e substituem o conteudo anterior', () => {
    const doc = new DocFalso();
    const raiz = new NoFalso('div', doc);
    const renderizar = carregarRenderizador();
    const telas: TelaVerificacao[] = [
      construirTela({ tipo: 'carregando' }),
      construirTela({ tipo: 'estado', estado: { estado: 'sem_envio', recurso: { situacao: 'indisponivel' } } }),
      construirTela({ tipo: 'estado', estado: { estado: 'em_analise', recurso: { situacao: 'indisponivel' } } }),
      construirTela({ tipo: 'estado', estado: { estado: 'aprovada', decididoEm: '2026-11-10T12:00:00.000Z', recurso: { situacao: 'indisponivel' } } }),
      construirTela({ tipo: 'estado', estado: { estado: 'recusada', recurso: { situacao: 'indisponivel' } } }),
      construirTela({ tipo: 'estado', estado: { estado: 'suspensa', recurso: { situacao: 'indisponivel' } } }),
      construirTela({ tipo: 'recurso_recebido' }),
      construirTela({ tipo: 'erro' }),
      construirTela({ tipo: 'recurso_indisponivel' }),
    ];
    for (const tela of telas) {
      renderizar(raiz, tela);
      expect(raiz.filhos.length).toBeGreaterThan(0);
      expect(raiz.filhos[0]!.textContent).toBe(tela.titulo);
      expect(raiz.atributos['data-estado']).toBe(tela.tipo);
    }
    expect(raiz.filhos.filter((n) => n.className === 'situacao-titulo')).toHaveLength(1);
  });
});
