// @vitest-environment happy-dom
// H-107 (Issue 116) | Teste de render do formulario do catalogo (docs/factory/77-REFINO-H107.md CA-11).
// Renderiza a tela de verdade (React em DOM simulado) e troca so a resposta da acao de salvar. Valores sinteticos.
// Prova: falha ao salvar mostra o erro, mantem o texto digitado e nao reseta o formulario; erro fica ligado ao campo.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormularioItem } from '../src/app/console/catalogo/formulario-item';
import { salvarCatalogo } from '../src/app/console/catalogo/actions';

// A acao de servidor e substituida: o teste nao chama API nem banco.
vi.mock('../src/app/console/catalogo/actions', () => ({ salvarCatalogo: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GRUPO = { id: 'g1', name: 'Grupo sintetico', position: 1, active: true, version: 2 };
const SERVICO = {
  id: 's1',
  group_id: 'g1',
  name: 'Servico sintetico',
  modality: 'presencial',
  regulated: false,
  active: true,
  version: 1,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function montarServico() {
  act(() => {
    root.render(
      <FormularioItem
        entidade="service"
        item={SERVICO}
        grupos={[GRUPO]}
        servicos={[]}
        titulo="Editar serviço sintético"
      />,
    );
  });
}

async function enviar() {
  const formulario = container.querySelector('form');
  if (!formulario) throw new Error('formulario nao renderizado');
  await act(async () => {
    formulario.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function campo(nome: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[name="${nome}"]`);
  if (!el) throw new Error(`campo ${nome} nao renderizado`);
  return el;
}

function digitar(el: HTMLInputElement, texto: string) {
  act(() => {
    el.value = texto;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('T-H107-R1 formulario do catalogo: estados de tela (CA-11)', () => {
  it('falha ao salvar: mostra o erro, mantem o texto digitado e nao limpa o formulario', async () => {
    vi.mocked(salvarCatalogo).mockResolvedValue({
      situacao: 'erro',
      mensagem: 'Não foi possível salvar. Tente de novo.',
      campos: {},
    });
    montarServico();
    const texto = 'Texto digitado pelo administrador sem perder';
    digitar(campo('name'), texto);

    await enviar();

    expect(salvarCatalogo).toHaveBeenCalledTimes(1);
    const alerta = container.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain('Não foi possível salvar. Tente de novo.');
    expect(campo('name').value).toBe(texto);
  });

  it('erro de um campo: o campo fica marcado como invalido e o aviso fica ligado a ele', async () => {
    vi.mocked(salvarCatalogo).mockResolvedValue({
      situacao: 'erro',
      mensagem: 'Corrija os campos destacados.',
      campos: { name: 'Informe o nome do serviço.' },
    });
    montarServico();
    digitar(campo('name'), 'Nome que o administrador digitou');

    await enviar();

    const nome = campo('name');
    expect(nome.getAttribute('aria-invalid')).toBe('true');
    const descricao = nome.getAttribute('aria-describedby');
    expect(descricao).toBeTruthy();
    expect(container.querySelector(`[id="${descricao}"]`)?.textContent).toBe('Informe o nome do serviço.');
    expect(nome.value).toBe('Nome que o administrador digitou');
  });
});
