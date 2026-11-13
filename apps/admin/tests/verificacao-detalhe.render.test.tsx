// @vitest-environment happy-dom
// Issue 52 (H-039) | Render da tela de detalhe do caso e do formulario de decisao (124 §5.4; decs. 375, 386, 387).
// Renderiza de verdade em DOM simulado. A acao de decisao e substituida: nada chama API nem banco. Valores sinteticos.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetalheCaso } from '../src/app/console/verificacao/[caso]/detalhe-caso';
import CarregandoCaso from '../src/app/console/verificacao/[caso]/loading';
import {
  estadoDoDetalhe,
  TEXTO_AVISO_COMPLEMENTO,
  TEXTO_CARREGANDO_CASO,
  TEXTO_ERRO_CASO,
  TEXTO_ERRO_LEITURA,
  TEXTO_SEM_DOCUMENTO,
  type EstadoDetalhe,
} from '../src/verification-detail-state';

vi.mock('../src/app/console/verificacao/[caso]/acoes', () => ({ decidirCaso: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CORPO = {
  id: 'caso-sintetico-1',
  short_id: 'ABC123',
  status: 'pendente',
  appeal_status: 'nenhum',
  sla_target_at: '2026-11-20T12:00:00.000Z',
  received_at: '2026-11-13T10:00:00.000Z',
  services: ['Servico sintetico'],
  overdue: false,
  assigned_to_me: false,
  version: 3,
  motivo: null,
  explicacao: null,
  decididoEm: null,
  documentoDisponivel: true,
  documentoRecebidoEm: '2026-11-13T10:00:00.000Z',
  documento: 'DOC-SINTETICO-NAO-EXPOR',
};

const OK: EstadoDetalhe = estadoDoDetalhe(200, CORPO);

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

function montar(estado: EstadoDetalhe, leituraErro = false) {
  act(() => {
    root.render(<DetalheCaso estado={estado} leituraErro={leituraErro} />);
  });
}

function digitar(texto: string) {
  const area = container.querySelector('textarea');
  if (!area) throw new Error('complemento nao renderizado');
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    definir?.call(area, texto);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('tela de detalhe do caso', () => {
  it('mostra so dados nao sensiveis e nunca o identificador do documento', () => {
    montar(OK);
    expect(container.textContent).toContain('Caso ABC123');
    expect(container.textContent).toContain('Servico sintetico');
    expect(container.innerHTML).not.toContain('DOC-SINTETICO');
  });

  it('documento disponivel: botao envia formulario para a rota de download, sem URL do arquivo na pagina', () => {
    montar(OK);
    const formulario = container.querySelector('form[method="post"][action$="/documento"]');
    expect(formulario?.getAttribute('action')).toBe('/console/verificacao/caso-sintetico-1/documento');
    expect(formulario?.querySelector('input[name="motivo"]')?.getAttribute('value')).toBe('analise_inicial');
    expect(container.textContent).toContain('Abrir documento');
    expect(container.querySelectorAll('img, iframe, embed, object, a[href*="documento"]')).toHaveLength(0);
  });

  it('documento indisponivel: aviso no lugar do botao de leitura', () => {
    const semDocumento = estadoDoDetalhe(200, { ...CORPO, documentoDisponivel: false });
    montar(semDocumento);
    expect(container.textContent).toContain(TEXTO_SEM_DOCUMENTO);
    expect(container.querySelector('form[action$="/documento"]')).toBeNull();
  });

  it('falha ao abrir o documento mostra aviso generico (sem detalhe tecnico)', () => {
    montar(OK, true);
    const alerta = container.querySelector('[role="alert"]');
    expect(alerta?.textContent).toBe(TEXTO_ERRO_LEITURA);
  });

  it('estado de erro mostra mensagem generica e nenhum formulario', () => {
    montar({ tipo: 'erro' });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(TEXTO_ERRO_CASO);
    expect(container.querySelector('form')).toBeNull();
  });

  it('vazio: caso sem servicos mostra "Não informado" e sem motivo de decisao', () => {
    montar(estadoDoDetalhe(200, { ...CORPO, services: [], received_at: null }));
    expect(container.textContent).toContain('Não informado');
    expect(container.textContent).toContain('Ainda não decidido');
  });

  it('carregando: tela de espera com aviso de status', () => {
    act(() => {
      root.render(<CarregandoCaso />);
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(TEXTO_CARREGANDO_CASO);
  });
});

describe('formulario de decisao', () => {
  it('mostra o aviso sobre dados pessoais junto ao complemento', () => {
    montar(OK);
    expect(container.textContent).toContain(TEXTO_AVISO_COMPLEMENTO);
  });

  it('o contador acompanha o texto digitado', () => {
    montar(OK);
    expect(container.textContent).toContain('0 de 500 caracteres');
    digitar('abcde');
    expect(container.textContent).toContain('5 de 500 caracteres');
  });

  it('com 501 caracteres o contador avisa e o envio fica desabilitado', () => {
    montar(OK);
    digitar('a'.repeat(501));
    expect(container.textContent).toContain('Encurte o texto para registrar.');
    const botao = container.querySelector('form[aria-label="Decisão do caso"] button[type="submit"]') as HTMLButtonElement | null;
    expect(botao?.disabled).toBe(true);
  });

  it('com 500 caracteres o envio continua disponivel', () => {
    montar(OK);
    digitar('a'.repeat(500));
    const botao = container.querySelector('form[aria-label="Decisão do caso"] button[type="submit"]') as HTMLButtonElement | null;
    expect(botao?.disabled).toBe(false);
  });
});
