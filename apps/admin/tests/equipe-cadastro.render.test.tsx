// @vitest-environment happy-dom
// Cadastro de admin na tela de Equipe: validacao por campo, envio a API e erro de e-mail ja usado.
import { ADMIN_GRANTABLE_ROLES, adminPasswordProblem } from '@fastpro/domain';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormularioAdmin, PAPEIS_OFERECIDOS } from '../src/app/console/equipe/formulario-admin';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SENHA = ['senha', 'sintetica', '2099'].join('-');
const criado = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<FormularioAdmin rotulos={{ auditor: 'Auditor' }} onCriado={criado} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const texto = (id: string) => container.querySelector(`#${id}`)?.textContent;

function digitar(id: string, valor: string) {
  const el = container.querySelector<HTMLInputElement>(`#${id}`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function enviar() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function preencher() {
  digitar('novo-email', 'nova@fastpro.example');
  digitar('novo-senha', SENHA);
  digitar('novo-confirmacao', SENHA);
  const auditor = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Auditor')!;
  act(() => auditor.click());
}

describe('cadastro de admin', () => {
  it('oferece os mesmos papeis que a API aceita e a mesma senha minima', () => {
    expect(PAPEIS_OFERECIDOS).toEqual([...ADMIN_GRANTABLE_ROLES]);
    expect(adminPasswordProblem('x'.repeat(11), 'a@b.co')).toBe('curta');
    expect(adminPasswordProblem('x'.repeat(12), 'a@b.co')).toBeNull();
  });

  it('nao oferece Superadmin; vazio mostra "Campo obrigatório." em tudo sem chamar a API', async () => {
    const chamada = vi.fn();
    vi.stubGlobal('fetch', chamada);
    expect(container.textContent).not.toContain('superadmin');
    await enviar();
    for (const id of ['novo-email', 'novo-senha', 'novo-confirmacao', 'novo-papeis']) {
      expect(texto(`${id}-erro`), id).toBe('Campo obrigatório.');
    }
    expect(chamada).not.toHaveBeenCalled();
  });

  it('senha curta e repeticao diferente tem mensagem propria', async () => {
    digitar('novo-senha', SENHA.slice(0, 5));
    digitar('novo-confirmacao', SENHA);
    await enviar();
    expect(texto('novo-senha-erro')).toContain('pelo menos 12');
    expect(texto('novo-confirmacao-erro')).toBe('As senhas não são iguais.');
  });

  it('cadastra, avisa a tela e limpa; e-mail usado aparece no campo', async () => {
    const chamada = vi
      .fn()
      .mockResolvedValueOnce({ status: 201, json: async () => ({}) })
      .mockResolvedValueOnce({ status: 409, json: async () => ({}) });
    vi.stubGlobal('fetch', chamada);
    preencher();
    await enviar();
    expect(chamada.mock.calls[0]?.[0]).toBe('/api/v1/admin/staff');
    expect(JSON.parse((chamada.mock.calls[0]?.[1] as { body: string }).body).roles).toEqual(['auditor']);
    expect(criado).toHaveBeenCalledOnce();
    expect(container.querySelector<HTMLInputElement>('#novo-email')!.value).toBe('');
    preencher();
    await enviar();
    expect(texto('novo-email-erro')).toContain('já tem conta');
  });
});
