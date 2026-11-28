// Pacote D (H-095, H-096, H-098) | Modelos dos avisos do ciclo central. Sem rede, sem envio.
import { describe, it, expect } from 'vitest';
import {
  CYCLE_TEMPLATE_KEYS,
  CycleRenderError,
  createCycleAwareRenderer,
  createMinimalRenderer,
  renderCycleEmail,
} from '../src/index.js';

const PEDIDO = '0f6c2a1e-9b3d-4e5f-8a7b-1c2d3e4f5a6b';
const SITE = 'https://fastpro.example.com/';
const ORIGEM = 'https://fastpro.example.com';

describe('modelos do ciclo central', () => {
  it('aceite: nome do servico e link do pedido, sem dado do profissional', () => {
    const out = renderCycleEmail('aceite_aviso', { request_ref: PEDIDO, servico: 'Aulas práticas' }, SITE);
    expect(out.subject).toBe('Um profissional aceitou seu pedido');
    expect(out.text).toContain('Um profissional aceitou o seu pedido de Aulas práticas no FastPro.');
    expect(out.text).toContain(`${ORIGEM}/painel/pedido/${PEDIDO}`);
  });

  it('aceite sem nome de servico usa a frase generica', () => {
    const out = renderCycleEmail('aceite_aviso', { request_ref: PEDIDO }, SITE);
    expect(out.text.startsWith('Um profissional aceitou o seu pedido no FastPro.')).toBe(true);
  });

  it('resumo de aceite informa a contagem e leva ao pedido', () => {
    const out = renderCycleEmail('aceite_resumo', { request_ref: PEDIDO, count: 3 }, SITE);
    expect(out.subject).toBe('Novos profissionais aceitaram seu pedido');
    expect(out.text).toContain('Novos profissionais aceitaram o seu pedido no FastPro: 3.');
    expect(out.text).toContain(`${ORIGEM}/painel/pedido/${PEDIDO}`);
  });

  it('mensagem do cliente: aviso sem texto da mensagem e link do pedido', () => {
    const out = renderCycleEmail('mensagem_aviso', { request_ref: PEDIDO }, SITE);
    expect(out.subject).toBe('Você tem uma nova mensagem');
    expect(out.text).toContain(`${ORIGEM}/painel/pedido/${PEDIDO}`);
  });

  it('mensagem do profissional: aviso e resumo levam a conversas, sem referencia de pedido', () => {
    const aviso = renderCycleEmail('mensagem_profissional_aviso', {}, SITE);
    expect(aviso.text).toContain(`${ORIGEM}/profissional/conversas`);
    expect(aviso.text).not.toContain(PEDIDO);
    const resumo = renderCycleEmail('mensagem_profissional_resumo', { count: 2 }, SITE);
    expect(resumo.subject).toBe('Você tem novas mensagens');
    expect(resumo.text).toContain('Você tem 2 novas mensagens no FastPro.');
    expect(resumo.text).toContain(`${ORIGEM}/profissional/conversas`);
  });

  it('selecao: "Voce foi escolhido" e "outro profissional" sem identidade de ninguem', () => {
    const escolhido = renderCycleEmail('selecao', { request_ref: PEDIDO }, SITE);
    expect(escolhido.subject).toBe('Você foi escolhido');
    const outro = renderCycleEmail('selecao_outro', { request_ref: PEDIDO }, SITE);
    expect(outro.subject).toBe('O cliente escolheu outro profissional');
    for (const corpo of [escolhido.text, outro.text]) {
      expect(corpo).toContain(`Pedido: ${PEDIDO}`);
      expect(corpo).not.toMatch(/Ana|Silva|Joao|João|Maria/);
    }
  });

  it('cancelamento avisa que o pedido foi cancelado', () => {
    const out = renderCycleEmail('cancelamento', { request_ref: PEDIDO }, SITE);
    expect(out.subject).toBe('O pedido foi cancelado');
    expect(out.text).toContain('foi cancelado no FastPro');
  });

  it('nenhum modelo usa travessao e todos terminam com o rodape de senha', () => {
    for (const key of CYCLE_TEMPLATE_KEYS) {
      const params: Record<string, unknown> = key.startsWith('mensagem_profissional')
        ? key.endsWith('resumo') ? { count: 1 } : {}
        : key.endsWith('resumo') ? { request_ref: PEDIDO, count: 1 } : { request_ref: PEDIDO };
      const out = renderCycleEmail(key, params, SITE);
      expect(out.text).not.toContain('—');
      expect(out.text).toContain('Ninguém do FastPro pede sua senha por e-mail.');
    }
  });
});

describe('falha fechada', () => {
  it('parametro fora do contrato ou modelo desconhecido: erro com codigo fixo', () => {
    expect(() => renderCycleEmail('aceite_resumo', { request_ref: PEDIDO }, SITE)).toThrow(CycleRenderError);
    expect(() => renderCycleEmail('aceite_aviso', { request_ref: 'nao-uuid' }, SITE)).toThrow(CycleRenderError);
    expect(() => renderCycleEmail('aceite_aviso', { request_ref: PEDIDO, servico: 'x@y' }, SITE)).toThrow(CycleRenderError);
    expect(() => renderCycleEmail('mensagem_profissional_resumo', { count: 1, request_ref: PEDIDO }, SITE)).toThrow(CycleRenderError);
    expect(() => renderCycleEmail('modelo_que_nao_existe', {}, SITE)).toThrow(CycleRenderError);
  });

  it('base do site invalida recusa a montagem do renderizador', () => {
    expect(() => createCycleAwareRenderer(createMinimalRenderer(), '')).toThrow(CycleRenderError);
    expect(() => createCycleAwareRenderer(createMinimalRenderer(), 'ftp://x.example.com')).toThrow(CycleRenderError);
  });

  it('o erro nao carrega o identificador nem a base', () => {
    try {
      renderCycleEmail('aceite_resumo', { request_ref: PEDIDO }, SITE);
    } catch (erro) {
      expect(String(erro)).not.toContain(PEDIDO);
      expect((erro as CycleRenderError).code).toBe('parametros_invalidos');
    }
  });
});

describe('renderizador envolvido', () => {
  it('usa os textos do ciclo e delega os demais modelos ao base', () => {
    const renderer = createCycleAwareRenderer(createMinimalRenderer(), SITE);
    expect(renderer.render('cancelamento', { request_ref: PEDIDO }).subject).toBe('O pedido foi cancelado');
    expect(renderer.render('modelo_do_base', {}).subject).toBe('Aviso do FastPro');
  });
});
