// Issue #153 | Testes do "Continuar" da inicial (docs/factory/175-DESENHO-WEB-INICIAL.md, §5.3 e §8, fatia 3).
// Fake do fetch sequencial (sem rede). Cobre CA-W06 a CA-W08 e CA-W19: criar (404 da API), atualizar (200),
// confirmar a troca de servico (decisao 941), falhas que nao navegam, API indisponivel (404 sem JSON), clique
// duplo e navegacao literal para /pedido.
import { describe, it, expect } from 'vitest';
import { ligarPagina } from '../public/inicio.js';
import {
  type Chamada,
  type Desfecho,
  criarJanela,
  escolherPrimeiroServico,
  esperar,
  rotaComBusca,
} from './inicio-dom-simulado';

const ATUAL = '/api/v1/drafts/current';
const CRIAR = '/api/v1/drafts';
const SEM_RASCUNHO: Desfecho = { status: 404, corpo: { code: 'nao_encontrado' } };

type Rotas = {
  atual?: (chamada: Chamada) => Desfecho | Promise<Desfecho>;
  criar?: (chamada: Chamada) => Desfecho | Promise<Desfecho>;
  atualizar?: (chamada: Chamada) => Desfecho | Promise<Desfecho>;
};

/** Roteador da API do rascunho. Sem rota definida para um metodo, o teste falha com "rota nao prevista". */
function rotas(r: Rotas) {
  return rotaComBusca((url, chamada) => {
    if (url === ATUAL && chamada.method === 'GET' && r.atual) return r.atual(chamada);
    if (url === ATUAL && chamada.method === 'PATCH' && r.atualizar) return r.atualizar(chamada);
    if (url === CRIAR && chamada.method === 'POST' && r.criar) return r.criar(chamada);
    return undefined;
  });
}

/** Monta a pagina, escolhe o servico e preenche o endereco (sem disparar sugestao). */
async function preenchida(r: Rotas, endereco = 'Rua das Flores, 10') {
  const ctx = criarJanela(rotas(r));
  ligarPagina(ctx.janela);
  await escolherPrimeiroServico(ctx);
  ctx.documento.getElementById('endereco').value = endereco;
  ctx.rodarTimers();
  return ctx;
}

const enviar = (ctx: ReturnType<typeof criarJanela>) => ctx.documento.getElementById('formulario').disparar('submit');
const cruas = (ctx: ReturnType<typeof criarJanela>) => ctx.chamadas.filter((c) => c.url !== '/api/v1/catalog/service-search');
const corpoDe = (c: Chamada | undefined) => JSON.parse(c?.body ?? '{}') as Record<string, unknown>;

describe('Continuar: criar quando nao ha rascunho (CA-W06, CA-W07; Issue 159, D-ARQ-159-4)', () => {
  it('escolher o servico cria o rascunho so com service_id; Continuar grava o endereco (PATCH) e vai a /pedido', async () => {
    let leituras = 0;
    const ctx = await preenchida({
      atual: () => {
        leituras += 1;
        return leituras === 1 ? SEM_RASCUNHO : { status: 200, corpo: { service_id: 'svc-1', description: null, urgency: null } };
      },
      criar: () => ({ status: 201, corpo: { service_id: 'svc-1' } }),
      atualizar: () => ({ status: 200, corpo: {} }),
    });
    await esperar();
    const criacao = cruas(ctx).find((c) => c.method === 'POST');
    expect(criacao?.url).toBe(CRIAR);
    expect(Object.keys(corpoDe(criacao))).toEqual(['service_id']);
    enviar(ctx);
    await esperar();
    const atualizacao = cruas(ctx).find((c) => c.method === 'PATCH');
    expect(Object.keys(corpoDe(atualizacao)).sort()).toEqual(['address_text', 'service_id']);
    expect(corpoDe(atualizacao)).toEqual({ service_id: 'svc-1', address_text: 'Rua das Flores, 10' });
    expect(cruas(ctx).filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(ctx.navegou).toEqual(['/pedido']);
  });
});

describe('Continuar: atualizar quando ha rascunho do mesmo servico (CA-W06)', () => {
  it('200 com mesmo servico -> PATCH com service_id e address_text, depois /pedido', async () => {
    const ctx = await preenchida({
      atual: () => ({ status: 200, corpo: { service_id: 'svc-1', description: null, urgency: null } }),
      atualizar: () => ({ status: 200, corpo: { service_id: 'svc-1' } }),
    });
    enviar(ctx);
    await esperar();
    const patch = cruas(ctx).find((c) => c.method === 'PATCH');
    expect(patch?.url).toBe(ATUAL);
    expect(corpoDe(patch)).toEqual({ service_id: 'svc-1', address_text: 'Rua das Flores, 10' });
    expect(cruas(ctx).some((c) => c.method === 'POST')).toBe(false);
    expect(ctx.navegou).toEqual(['/pedido']);
  });
});

describe('Continuar: confirmacao ao trocar de servico com conteudo (decisao 941)', () => {
  const comConteudo: Rotas = {
    atual: () => ({ status: 200, corpo: { service_id: 'svc-9', description: 'Tomada queimada', urgency: 'imediato' } }),
    atualizar: () => ({ status: 200, corpo: { service_id: 'svc-1' } }),
  };

  it('mostra o bloco de confirmacao sem gravar nada e foca o titulo', async () => {
    const ctx = await preenchida(comConteudo);
    enviar(ctx);
    await esperar();
    expect(ctx.documento.getElementById('substituir').hidden).toBe(false);
    expect(ctx.documento.getElementById('continuar').hidden).toBe(true);
    expect(ctx.documento.activeElement?.id).toBe('substituir-titulo');
    expect(cruas(ctx).filter((c) => c.method !== 'GET')).toHaveLength(0);
    expect(ctx.navegou).toEqual([]);
  });

  it('"Trocar e continuar" faz PATCH so com service_id e address_text (descricao e urgencia ficam) e vai a /pedido', async () => {
    const ctx = await preenchida(comConteudo);
    enviar(ctx);
    await esperar();
    ctx.documento.getElementById('substituir-trocar').disparar('click');
    await esperar();
    const patch = cruas(ctx).find((c) => c.method === 'PATCH');
    expect(Object.keys(corpoDe(patch)).sort()).toEqual(['address_text', 'service_id']);
    expect(ctx.navegou).toEqual(['/pedido']);
  });

  it('"Voltar ao pedido que já existe" vai a /pedido sem gravar nada', async () => {
    const ctx = await preenchida(comConteudo);
    enviar(ctx);
    await esperar();
    ctx.documento.getElementById('substituir-voltar').disparar('click');
    expect(cruas(ctx).filter((c) => c.method !== 'GET')).toHaveLength(0);
    expect(ctx.navegou).toEqual(['/pedido']);
  });
});

describe('Continuar: falhas nao navegam e mantem os campos (CA-W08, RN-W-10)', () => {
  it('erro 500 na criacao: mostra E-07, nao navega, mantem servico e endereco', async () => {
    const ctx = await preenchida({
      atual: () => SEM_RASCUNHO,
      criar: () => ({ status: 500, corpo: { code: 'erro' } }),
    });
    enviar(ctx);
    await esperar();
    expect(ctx.documento.getElementById('estado').textContent).toBe(
      'Não foi possível continuar agora. Seus dados estão aqui; tente de novo.',
    );
    expect(ctx.navegou).toEqual([]);
    expect(ctx.documento.getElementById('servico').value).toBe('Eletricista');
    expect(ctx.documento.getElementById('endereco').value).toBe('Rua das Flores, 10');
    expect(ctx.documento.getElementById('continuar').disabled).toBe(false);
    expect(ctx.documento.getElementById('inicio-raiz').getAttribute('aria-busy')).toBe('false');
  });

  it('404 sem JSON na leitura (API indisponivel): E-07 e nenhum POST', async () => {
    const ctx = await preenchida({
      atual: () => ({ status: 404, semJson: true }),
      criar: () => ({ status: 201, corpo: {} }),
    });
    enviar(ctx);
    await esperar();
    expect(ctx.documento.getElementById('estado').textContent).toBe(
      'Não foi possível continuar agora. Seus dados estão aqui; tente de novo.',
    );
    expect(cruas(ctx).some((c) => c.method === 'POST')).toBe(false);
    expect(ctx.navegou).toEqual([]);
  });

  it('falha de rede na leitura: E-07 e nao navega', async () => {
    const ctx = await preenchida({ atual: () => 'rede' });
    enviar(ctx);
    await esperar();
    expect(ctx.documento.getElementById('estado').textContent).toBe(
      'Não foi possível continuar agora. Seus dados estão aqui; tente de novo.',
    );
    expect(ctx.navegou).toEqual([]);
  });

  it('429 na criacao: mensagem de muitas tentativas, sem navegar', async () => {
    const ctx = await preenchida({
      atual: () => SEM_RASCUNHO,
      criar: () => ({ status: 429, corpo: { code: 'limite' } }),
    });
    enviar(ctx);
    await esperar();
    expect(ctx.documento.getElementById('estado').textContent).toBe(
      'Muitas tentativas. Aguarde um instante e tente de novo.',
    );
    expect(ctx.navegou).toEqual([]);
  });
});

describe('Continuar: envio em curso (CA-W08)', () => {
  it('botao desabilitado e aria-busy durante o envio; clique duplo gera uma so leitura', async () => {
    let liberar: (d: Desfecho) => void = () => undefined;
    const pendente = new Promise<Desfecho>((resolver) => {
      liberar = resolver;
    });
    let leituras = 0;
    const ctx = await preenchida({
      atual: () => {
        leituras += 1;
        return leituras === 1 ? SEM_RASCUNHO : pendente;
      },
      criar: () => ({ status: 201, corpo: {} }),
      atualizar: () => ({ status: 200, corpo: {} }),
    });
    await esperar();
    const leiturasDaEscolha = leituras;
    enviar(ctx);
    enviar(ctx);
    await esperar();
    const botao = ctx.documento.getElementById('continuar');
    expect(botao.disabled).toBe(true);
    expect(botao.textContent).toBe('Aguarde…');
    expect(ctx.documento.getElementById('inicio-raiz').getAttribute('aria-busy')).toBe('true');
    expect(leituras - leiturasDaEscolha).toBe(1);
    liberar({ status: 200, corpo: { service_id: 'svc-1', description: null, urgency: null } });
    await esperar();
    expect(cruas(ctx).filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(cruas(ctx).filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(ctx.navegou).toEqual(['/pedido']);
  });
});
