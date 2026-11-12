// H-035 | Tela do cadastro do documento (docs/factory/75-DESENHO-H035.md §5; CA-11, CA-12, CA-13).
// Sem DOM real e sem rede: o controlador recebe um documento falso e uma funcao de rede falsa.
// Confere-se o corpo enviado, os estados (vazio, erro, sucesso), os erros ligados aos campos, o foco no erro,
// o envio duplo bloqueado e a mensagem de duplicidade igual a de sucesso.
globalThis.fetch = () => {
  throw new Error('rede bloqueada nos testes de H-035 (UI)');
};

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CADASTRO_ENDPOINT,
  MENSAGENS,
  interpretarResposta,
  iniciarCadastro,
  montarCorpo,
  motivoParaCampo,
} from '../public/profissional-documento.js';

const lerArquivo = (caminho: string) => readFileSync(new URL(caminho, import.meta.url), 'utf8');

class Elemento {
  value = '';
  textContent = '';
  disabled = false;
  foco = 0;
  private readonly attrs = new Map<string, string>();
  constructor(readonly id: string) {}
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
}

class Formulario extends Elemento {
  private readonly ouvintes: Array<(evento: { preventDefault(): void }) => void> = [];
  addEventListener(_tipo: string, fn: (evento: { preventDefault(): void }) => void) {
    this.ouvintes.push(fn);
  }
  enviar() {
    for (const fn of this.ouvintes) fn({ preventDefault() {} });
  }
}

interface Pendente {
  resolve(valor: unknown): void;
  reject(erro: unknown): void;
}

function montar() {
  const ids = ['nome', 'tipo', 'documento', 'salvar', 'aviso', 'alerta', 'erro-nome', 'erro-tipo', 'erro-documento', 'dica-nome', 'dica-documento'];
  const mapa = new Map<string, Elemento>(ids.map((id) => [id, new Elemento(id)]));
  const form = new Formulario('cadastro');
  mapa.set('cadastro', form);
  const doc = { getElementById: (id: string) => mapa.get(id) ?? null };

  const chamadas: Array<[string, Record<string, unknown>]> = [];
  const pendentes: Pendente[] = [];
  const buscar = (url: string, opcoes: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      chamadas.push([url, opcoes]);
      pendentes.push({ resolve, reject });
    });

  iniciarCadastro(doc as unknown as Document, buscar as unknown as typeof fetch);
  const el = (id: string) => mapa.get(id)!;
  const responder = async (status: number, corpo: unknown) => {
    const p = pendentes.shift()!;
    p.resolve({ status, json: async () => corpo });
    await new Promise((ok) => setTimeout(ok, 0));
  };
  const falhar = async () => {
    const p = pendentes.shift()!;
    p.reject(new TypeError('falha de rede simulada'));
    await new Promise((ok) => setTimeout(ok, 0));
  };
  return { el, form, chamadas, pendentes, responder, falhar };
}

function preencher(t: ReturnType<typeof montar>, valores: { nome?: string; tipo?: string; documento?: string }) {
  t.el('nome').value = valores.nome ?? 'Nome Sintetico';
  t.el('tipo').value = valores.tipo ?? 'CPF';
  t.el('documento').value = valores.documento ?? '123.456.789-09';
}

describe('interpretarResposta (H-035, CA-05, CA-11, CA-13)', () => {
  it('201 recebido e 200 ja cadastrado mostram a mesma mensagem de sucesso', () => {
    const novo = interpretarResposta(201, { status: 'received', verification: 'pending' });
    const repetido = interpretarResposta(200, { status: 'ja_cadastrado' });
    expect(novo).toEqual({ resultado: 'sucesso', mensagem: MENSAGENS.sucesso, campos: [] });
    expect(repetido.mensagem).toBe(novo.mensagem);
  });

  it('mensagens nao revelam duplicidade nem outro perfil', () => {
    for (const texto of Object.values(MENSAGENS)) {
      expect(texto.toLowerCase()).not.toMatch(/duplic|j[aá] existe|outro perfil|outra conta/);
    }
  });

  it('422 mapeia cada campo e ignora campos desconhecidos', () => {
    const r = interpretarResposta(422, {
      code: 'invalid_field',
      fields: [
        { field: 'document', reason: 'digito_verificador' },
        { field: 'publicName', reason: 'tamanho' },
        { field: 'campo_estranho', reason: 'formato' },
      ],
    });
    expect(r.resultado).toBe('campos');
    expect(r.campos.map((c) => c.campo)).toEqual(['document', 'publicName']);
    expect(r.campos[0]!.mensagem).toBe(motivoParaCampo('document', 'digito_verificador'));
  });

  it('401, 403 sem e-mail verificado e falha de servico tem mensagem acionavel', () => {
    expect(interpretarResposta(401, { code: 'nao_autenticado' }).mensagem).toBe(MENSAGENS.naoAutenticado);
    expect(interpretarResposta(403, { code: 'email_nao_verificado' }).mensagem).toBe(MENSAGENS.emailNaoVerificado);
    expect(interpretarResposta(503, { code: 'servico_indisponivel' }).mensagem).toBe(MENSAGENS.indisponivel);
  });
});

describe('motivoParaCampo e montarCorpo (H-035)', () => {
  it('explica o tamanho do CPF e do CNPJ sem eco do valor', () => {
    expect(motivoParaCampo('document', 'tamanho')).toContain('11');
    expect(motivoParaCampo('document', 'tamanho')).toContain('14');
  });

  it('monta o corpo com os nomes da API, sem normalizar o numero', () => {
    expect(montarCorpo({ nome: 'Ana', tipo: 'CNPJ', documento: '12.345.678/0001-95' })).toEqual({
      publicName: 'Ana',
      documentType: 'CNPJ',
      document: '12.345.678/0001-95',
    });
  });
});

describe('iniciarCadastro (H-035, CA-11, CA-12, CA-13)', () => {
  it('estado vazio: aviso de preenchimento e nenhum erro', () => {
    const t = montar();
    expect(t.el('aviso').textContent).toBe(MENSAGENS.vazio);
    expect(t.el('alerta').textContent).toBe('');
    expect(t.el('erro-documento').textContent).toBe('');
  });

  it('envia PUT para a API com o corpo JSON e mesma origem, sem redirecionar', async () => {
    const t = montar();
    preencher(t, {});
    t.form.enviar();
    expect(t.chamadas).toHaveLength(1);
    const [url, opcoes] = t.chamadas[0]!;
    expect(url).toBe(CADASTRO_ENDPOINT);
    expect(opcoes.method).toBe('PUT');
    expect(opcoes.credentials).toBe('same-origin');
    expect(opcoes.redirect).toBe('error');
    expect(JSON.parse(String(opcoes.body))).toEqual({
      publicName: 'Nome Sintetico',
      documentType: 'CPF',
      document: '123.456.789-09',
    });
    expect(t.el('salvar').disabled).toBe(true);
    await t.responder(201, { status: 'received', verification: 'pending' });
    expect(t.el('salvar').disabled).toBe(false);
  });

  it('envio duplo: o segundo clique nao gera outra chamada (CA-11)', async () => {
    const t = montar();
    preencher(t, {});
    t.form.enviar();
    t.form.enviar();
    expect(t.chamadas).toHaveLength(1);
    await t.responder(201, { status: 'received', verification: 'pending' });
  });

  it('sucesso: mensagem de recebimento e numero limpo da tela', async () => {
    const t = montar();
    preencher(t, {});
    t.form.enviar();
    await t.responder(201, { status: 'received', verification: 'pending' });
    expect(t.el('aviso').textContent).toBe(MENSAGENS.sucesso);
    expect(t.el('alerta').textContent).toBe('');
    expect(t.el('documento').value).toBe('');
  });

  it('erro por campo: liga o erro ao campo, marca invalido e foca o primeiro campo com erro', async () => {
    const t = montar();
    preencher(t, { documento: '111.111.111-11' });
    t.form.enviar();
    await t.responder(422, {
      code: 'invalid_field',
      fields: [{ field: 'document', reason: 'sequencia_repetida' }],
    });
    const doc = t.el('documento');
    expect(doc.getAttribute('aria-invalid')).toBe('true');
    expect(doc.getAttribute('aria-describedby')).toBe('dica-documento erro-documento');
    expect(t.el('erro-documento').textContent).toBe(motivoParaCampo('document', 'sequencia_repetida'));
    expect(doc.foco).toBe(1);
    expect(t.el('alerta').textContent).toBe(MENSAGENS.campos);
    expect(t.el('aviso').textContent).toBe('');
    expect(doc.value).toBe('111.111.111-11');
  });

  it('erro de rede: mensagem acionavel e campos preenchidos', async () => {
    const t = montar();
    preencher(t, { nome: 'Ana Sintetica', documento: '12345678909' });
    t.form.enviar();
    await t.falhar();
    expect(t.el('alerta').textContent).toBe(MENSAGENS.rede);
    expect(t.el('nome').value).toBe('Ana Sintetica');
    expect(t.el('documento').value).toBe('12345678909');
    expect(t.el('salvar').disabled).toBe(false);
  });

  it('novo envio limpa o erro anterior do campo', async () => {
    const t = montar();
    preencher(t, { documento: '1' });
    t.form.enviar();
    await t.responder(422, { fields: [{ field: 'document', reason: 'tamanho' }] });
    expect(t.el('documento').getAttribute('aria-invalid')).toBe('true');
    t.form.enviar();
    expect(t.el('documento').getAttribute('aria-invalid')).toBeNull();
    expect(t.el('erro-documento').textContent).toBe('');
    await t.responder(201, { status: 'received', verification: 'pending' });
  });
});

describe('pagina estatica e CSP (H-035, CA-12)', () => {
  const html = lerArquivo('../public/profissional-documento.html');

  it('cada campo tem rotulo ligado por for, e ha regioes de aviso e de erro', () => {
    for (const id of ['tipo', 'nome', 'documento']) {
      expect(html).toMatch(new RegExp(`<label for="${id}">`));
      expect(html).toMatch(new RegExp(`id="${id}"`));
    }
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
    expect(html).toContain('lang="pt-BR"');
  });

  it('nao tem estilo nem script inline (CSP script-src e style-src self)', () => {
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<script(?![^>]*src=)/);
    expect(html).toContain('<script type="module" src="/profissional-documento.js">');
  });

  it('o CSS nao traz cor literal: so variaveis de token', () => {
    const css = lerArquivo('../public/profissional-documento.css');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|hsl)a?\(/);
    expect(css).toContain('var(--color-error-text)');
  });

  it('vercel.json aplica a politica estrita a pagina do cadastro', () => {
    const config = JSON.parse(lerArquivo('../vercel.json')) as {
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };
    const bloco = config.headers.find((h) => h.source === '/profissional-documento');
    const csp = bloco?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("form-action 'none'");
  });
});
