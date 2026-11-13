// H-030 (Issue #43) | Testes da logica pura de pedido e revisao (docs/factory/90-DESENHO-H030.md, §7.3).
// Relogio, temporizador e rede sao falsos: nenhuma chamada de rede, nenhum navegador. Cobre CA-02, CA-03,
// CA-06 (so o clique confirma), CA-08 (botao e clique unico), CA-09 (tratamento de conteudo alterado) e CA-13.
import { describe, it, expect, vi } from 'vitest';
import {
  PEDIDO_CAMPOS_REVISAO,
  PEDIDO_DESCRICAO_MAX,
  PEDIDO_ESPERA_INTERVALO_MS,
  PEDIDO_ESPERA_LIMITE_MS,
  PEDIDO_SALVAR_ATRASO_MS,
  PEDIDO_TEXTOS,
  PEDIDO_URGENCIAS,
  criarControladorBusca,
  criarControladorConfirmacao,
  criarControladorEspera,
  criarControladorSalvamento,
  descricaoDentroDoLimite,
  faltandoParaRevisao,
  interpretarConfirmacao,
  interpretarRevisao,
  resumoFaltando,
} from '../public/pedido-logica.js';

/** Relogio falso: agendar/cancelar e agora sao controlados pelo teste. */
function relogioFalso() {
  let agoraMs = 0;
  let id = 0;
  const agendados = new Map<number, { at: number; fn: () => void }>();
  const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    agora: () => agoraMs,
    agendar: (fn: () => void, ms: number) => {
      id += 1;
      agendados.set(id, { at: agoraMs + ms, fn });
      return id;
    },
    cancelar: (n: number) => {
      agendados.delete(n);
    },
    quantidadeAgendada: () => agendados.size,
    async avancar(ms: number) {
      const fim = agoraMs + ms;
      for (;;) {
        const proximo = [...agendados.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!proximo || proximo[1].at > fim) break;
        agendados.delete(proximo[0]);
        agoraMs = proximo[1].at;
        proximo[1].fn();
        await esperar();
      }
      agoraMs = fim;
      await esperar();
    },
    esperar,
  };
}

const completo = {
  service_id: 's1',
  address_text: 'Rua Sintetica 100',
  urgency: 'imediato',
  description: 'Descricao sintetica',
  first_name: 'Ana',
  email: 'cliente@example.test',
};

describe('CA-02 urgencia exata', () => {
  it('oferece exatamente os 4 rotulos na ordem da tela', () => {
    expect(PEDIDO_URGENCIAS.map((u) => u.rotulo)).toEqual([
      'Imediato',
      'Nas próximas semanas',
      'Próximo mês',
      'Ainda não defini',
    ]);
  });
});

describe('CA-03 campos para revisar', () => {
  it('lista na ordem fixa e trata vazio, espacos e urgencia fora da lista como faltando', () => {
    const r = faltandoParaRevisao({
      ...completo,
      service_id: null,
      address_text: '   ',
      urgency: 'invalida',
      first_name: '',
    });
    expect(r).toEqual(['service_id', 'address_text', 'urgency', 'first_name']);
  });

  it('pedido completo nao falta nada', () => {
    expect(faltandoParaRevisao(completo)).toEqual([]);
  });

  it('o resumo usa os rotulos da tela e a frase aprovada', () => {
    expect(resumoFaltando(['service_id', 'email'])).toBe('Falta preencher: Serviço, E-mail.');
  });

  it('a ordem de campos e a do dominio', () => {
    expect(PEDIDO_CAMPOS_REVISAO).toEqual([
      'service_id',
      'address_text',
      'urgency',
      'description',
      'first_name',
      'email',
    ]);
  });

  it('descricao tem limite de 2000 caracteres', () => {
    expect(PEDIDO_DESCRICAO_MAX).toBe(2000);
    expect(descricaoDentroDoLimite('a'.repeat(2000))).toBe(true);
    expect(descricaoDentroDoLimite('a'.repeat(2001))).toBe(false);
  });
});

describe('mapeamento das respostas (90 §2.1 e §2.2)', () => {
  it('revisao: 200 pronto, 409 aguardando, 422 campos, 404 vazio, 429 limite, demais erro', () => {
    expect(interpretarRevisao(200, { id: 'x' }).tipo).toBe('pronto');
    expect(interpretarRevisao(409, { code: 'email_nao_confirmado' }).tipo).toBe('aguardando');
    expect(interpretarRevisao(422, { code: 'campos_faltando', missing: ['email'] })).toEqual({
      tipo: 'campos',
      missing: ['email'],
    });
    expect(interpretarRevisao(404, { code: 'nao_encontrado' }).tipo).toBe('vazio');
    expect(interpretarRevisao(429, {}).tipo).toBe('limite');
    expect(interpretarRevisao(503, {}).tipo).toBe('erro');
  });

  it('confirmacao: 200 confirmado, 409 conteudo alterado e e-mail, 422, 404, 429, demais falha', () => {
    const ok = interpretarConfirmacao(200, {
      status: 'confirmado',
      confirmed_at: '2026-11-12T10:00:00.000Z',
      content_rev: 0,
    });
    expect(ok.tipo).toBe('confirmado');
    expect(interpretarConfirmacao(409, { code: 'conteudo_alterado' }).tipo).toBe('conteudo_alterado');
    expect(interpretarConfirmacao(409, { code: 'email_nao_confirmado' }).tipo).toBe('email');
    expect(interpretarConfirmacao(422, { code: 'campos_faltando', missing: ['urgency'] }).tipo).toBe('campos');
    expect(interpretarConfirmacao(404, {}).tipo).toBe('vazio');
    expect(interpretarConfirmacao(429, {}).tipo).toBe('limite');
    expect(interpretarConfirmacao(500, {}).tipo).toBe('falha');
  });

  it('CA-13: o texto de confirmado nao diz que o pedido foi publicado (so a frase aprovada)', () => {
    expect(PEDIDO_TEXTOS.confirmado).toBe('Pedido confirmado. Ainda não foi publicado.');
    const textos = Object.values(PEDIDO_TEXTOS).filter((t) => /publicad/i.test(t));
    expect(textos).toEqual(['Pedido confirmado. Ainda não foi publicado.']);
  });
});

describe('CA-06 e CA-08 confirmacao expressa', () => {
  it('nao envia nada sem o clique (confirmar)', () => {
    const enviar = vi.fn();
    criarControladorConfirmacao({ enviar, onEstado: () => {} });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('clique duplo ou triplo gera uma so requisicao e o estado passa por confirmando', async () => {
    const enviar = vi.fn(async () => ({
      status: 200,
      corpo: { status: 'confirmado', confirmed_at: '2026-11-12T10:00:00.000Z', content_rev: 0 },
    }));
    const estados: string[] = [];
    const c = criarControladorConfirmacao({ enviar, onEstado: (e) => estados.push(e.tipo) });
    const a = c.confirmar(0);
    const b = c.confirmar(0);
    const d = c.confirmar(0);
    expect(c.emCurso()).toBe(true);
    const [ra, rb, rd] = await Promise.all([a, b, d]);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(ra).toBe(rb);
    expect(rd.tipo).toBe('confirmado');
    expect(estados).toEqual(['confirmando', 'confirmado']);
    expect(c.emCurso()).toBe(false);
  });

  it('falha de rede volta a falha sem perder o estado de confirmar', async () => {
    const c = criarControladorConfirmacao({
      enviar: async () => {
        throw new Error('rede');
      },
      onEstado: () => {},
    });
    expect((await c.confirmar(0)).tipo).toBe('falha');
    expect(c.estado().tipo).toBe('falha');
  });
});

describe('salvamento do rascunho (H-025 R6)', () => {
  it('acumula campos, espera 800 ms e envia uma vez', async () => {
    const r = relogioFalso();
    const enviar = vi.fn(async () => ({ status: 200 }));
    const s = criarControladorSalvamento({
      enviar,
      agendar: r.agendar,
      cancelar: r.cancelar,
      onEstado: () => {},
    });
    s.alterar({ address_text: 'Rua A' });
    await r.avancar(400);
    s.alterar({ description: 'Texto' });
    await r.avancar(PEDIDO_SALVAR_ATRASO_MS - 1);
    expect(enviar).not.toHaveBeenCalled();
    await r.avancar(1);
    await r.esperar();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0]).toEqual({ address_text: 'Rua A', description: 'Texto' });
  });

  it('uma requisicao em voo por vez: alteracao durante o envio vai depois', async () => {
    const r = relogioFalso();
    let liberar: () => void = () => {};
    const enviar = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (liberar = () => resolve({ status: 200 }))))
      .mockResolvedValue({ status: 200 });
    const s = criarControladorSalvamento({ enviar, agendar: r.agendar, cancelar: r.cancelar, onEstado: () => {} });
    s.alterar({ urgency: 'imediato' });
    await r.avancar(PEDIDO_SALVAR_ATRASO_MS);
    expect(enviar).toHaveBeenCalledTimes(1);
    s.alterar({ description: 'Nova' });
    await r.avancar(PEDIDO_SALVAR_ATRASO_MS);
    expect(enviar).toHaveBeenCalledTimes(1);
    liberar();
    await r.esperar();
    await r.esperar();
    expect(enviar).toHaveBeenCalledTimes(2);
    expect(enviar.mock.calls[1][0]).toEqual({ description: 'Nova' });
  });

  it('erro ao salvar mantem o valor pendente e avisa; 404 leva ao estado vazio', async () => {
    const r = relogioFalso();
    const estados: string[] = [];
    const s = criarControladorSalvamento({
      enviar: async () => ({ status: 503 }),
      agendar: r.agendar,
      cancelar: r.cancelar,
      onEstado: (e) => estados.push(e.tipo),
    });
    s.alterar({ description: 'Preciso guardar' });
    await r.avancar(PEDIDO_SALVAR_ATRASO_MS);
    await r.esperar();
    expect(estados).toContain('erro_salvar');
    expect(s.pendente()).toBe(true);
    const s2 = criarControladorSalvamento({
      enviar: async () => ({ status: 404 }),
      agendar: r.agendar,
      cancelar: r.cancelar,
      onEstado: (e) => estados.push(e.tipo),
    });
    s2.alterar({ description: 'x' });
    await r.avancar(PEDIDO_SALVAR_ATRASO_MS);
    await r.esperar();
    expect(estados).toContain('vazio');
  });

  it('liberar envia o pendente agora, sem esperar o atraso', async () => {
    const r = relogioFalso();
    const enviar = vi.fn(async () => ({ status: 200 }));
    const s = criarControladorSalvamento({ enviar, agendar: r.agendar, cancelar: r.cancelar, onEstado: () => {} });
    s.alterar({ urgency: 'proximo_mes' });
    const ok = await s.liberar();
    expect(ok).toBe(true);
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});

describe('busca de servico (H-019)', () => {
  it('nao busca com menos de 2 caracteres e espera 300 ms antes de buscar', async () => {
    const r = relogioFalso();
    const enviar = vi.fn(async () => ({ status: 200, corpo: { status: 'ok', items: [{ service_id: 's1' }] } }));
    const estados: string[] = [];
    const b = criarControladorBusca({ enviar, agendar: r.agendar, cancelar: r.cancelar, onEstado: (e) => estados.push(e.tipo) });
    b.digitar('e');
    await r.avancar(1000);
    expect(enviar).not.toHaveBeenCalled();
    b.digitar('ele');
    await r.avancar(299);
    expect(enviar).not.toHaveBeenCalled();
    await r.avancar(1);
    await r.esperar();
    expect(enviar).toHaveBeenCalledWith('ele');
    expect(estados).toContain('resultado');
  });

  it('resposta antiga nao sobrescreve a busca mais nova', async () => {
    const r = relogioFalso();
    let respostaAntiga: (v: unknown) => void = () => {};
    const enviar = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (respostaAntiga = resolve)))
      .mockResolvedValueOnce({ status: 200, corpo: { status: 'vazio', code: 'sem_resultado', items: [] } });
    const estados: string[] = [];
    const b = criarControladorBusca({ enviar, agendar: r.agendar, cancelar: r.cancelar, onEstado: (e) => estados.push(e.tipo) });
    b.digitar('ab');
    await r.avancar(300);
    b.digitar('abc');
    await r.avancar(300);
    await r.esperar();
    respostaAntiga({ status: 200, corpo: { status: 'ok', items: [{}] } });
    await r.esperar();
    expect(estados).toEqual(['sem_resultado']);
  });
});

describe('espera do e-mail (90 §5.1)', () => {
  it('consulta a cada 5 s e para ao receber pronto, sem confirmar nada', async () => {
    const r = relogioFalso();
    const consultar = vi
      .fn()
      .mockResolvedValueOnce({ tipo: 'aguardando' })
      .mockResolvedValueOnce({ tipo: 'aguardando' })
      .mockResolvedValueOnce({ tipo: 'pronto', view: {} });
    const estados: string[] = [];
    const e = criarControladorEspera({
      consultar,
      agendar: r.agendar,
      cancelar: r.cancelar,
      agora: r.agora,
      onEstado: (x) => estados.push(x.tipo),
    });
    e.iniciar();
    await r.esperar();
    expect(consultar).toHaveBeenCalledTimes(1);
    await r.avancar(PEDIDO_ESPERA_INTERVALO_MS);
    await r.esperar();
    await r.avancar(PEDIDO_ESPERA_INTERVALO_MS);
    await r.esperar();
    expect(consultar).toHaveBeenCalledTimes(3);
    expect(estados).toEqual(['pronto']);
    expect(e.ativo()).toBe(false);
    await r.avancar(PEDIDO_ESPERA_INTERVALO_MS * 4);
    expect(consultar).toHaveBeenCalledTimes(3);
  });

  it('nao consulta com a aba oculta e retoma quando ela volta', async () => {
    const r = relogioFalso();
    let visivelAgora = false;
    const consultar = vi.fn(async () => ({ tipo: 'aguardando' }));
    const e = criarControladorEspera({
      consultar,
      agendar: r.agendar,
      cancelar: r.cancelar,
      agora: r.agora,
      visivel: () => visivelAgora,
      onEstado: () => {},
    });
    e.iniciar();
    await r.avancar(PEDIDO_ESPERA_INTERVALO_MS * 3);
    expect(consultar).not.toHaveBeenCalled();
    visivelAgora = true;
    e.aoVisibilidade(true);
    await r.esperar();
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it('para com "expirou" depois de 15 min sem confirmacao', async () => {
    const r = relogioFalso();
    const estados: string[] = [];
    const e = criarControladorEspera({
      consultar: async () => ({ tipo: 'aguardando' }),
      agendar: r.agendar,
      cancelar: r.cancelar,
      agora: r.agora,
      onEstado: (x) => estados.push(x.tipo),
    });
    e.iniciar();
    await r.avancar(PEDIDO_ESPERA_LIMITE_MS + PEDIDO_ESPERA_INTERVALO_MS);
    await r.esperar();
    expect(estados).toEqual(['expirou']);
    expect(e.ativo()).toBe(false);
  });
});
