// @vitest-environment happy-dom
// Tela de entrada do admin por e-mail e senha: campo invalido marca a borda e mostra a mensagem abaixo.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EntrarAdmin from '../src/app/entrar/page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<EntrarAdmin />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const campo = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)!;

function digitar(id: string, valor: string) {
  const el = campo(id);
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

describe('entrada do admin', () => {
  it('pede e-mail e senha, sem codigo nem cadastro', () => {
    expect(campo('email')).not.toBeNull();
    expect(campo('senha').type).toBe('password');
    expect(container.textContent).not.toMatch(/código|cadastr/i);
  });

  it('vazio: "Campo obrigatório." nos dois, sem chamar a API; corrigir limpa', async () => {
    const chamada = vi.fn();
    vi.stubGlobal('fetch', chamada);
    await enviar();
    expect(container.querySelector('#email-erro')?.textContent).toBe('Campo obrigatório.');
    expect(container.querySelector('#senha-erro')?.textContent).toBe('Campo obrigatório.');
    expect(campo('email').getAttribute('aria-invalid')).toBe('true');
    expect(chamada).not.toHaveBeenCalled();
    digitar('email', 'equipe@fastpro.example');
    expect(container.querySelector('#email-erro')).toBeNull();
    expect(campo('email').getAttribute('aria-invalid')).toBeNull();
  });

  it('acerto vai ao console; recusa mostra a mensagem sem sair da tela', async () => {
    const chamada = vi.fn().mockResolvedValueOnce({ status: 401 }).mockResolvedValueOnce({ status: 200 });
    vi.stubGlobal('fetch', chamada);
    digitar('email', 'equipe@fastpro.example');
    digitar('senha', 'senha-sintetica-2099');
    await enviar();
    expect(container.textContent).toContain('E-mail ou senha incorretos.');
    expect(push).not.toHaveBeenCalled();
    await enviar();
    expect(chamada.mock.calls[1]?.[0]).toBe('/api/v1/admin/auth/login');
    expect(push).toHaveBeenCalledWith('/console');
  });
});
