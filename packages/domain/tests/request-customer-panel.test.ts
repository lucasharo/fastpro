// Issue 47 (H-034) | Testes puros do painel do cliente (docs/factory/133-DESENHO-H034.md, §4, §7, §8; T-04, T-05, T-06, T-09).
import { describe, expect, it } from 'vitest';
import {
  DEADLINE_LABEL,
  PANEL_ITEM_KEYS,
  PANEL_TEXT,
  REQUEST_LIST_PAGE_SIZE,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUSES,
  deadlineLabelOf,
  deadlineState,
  encodeListCursor,
  panelItemLabels,
  parseListCursor,
} from '../src/request/customer-panel.js';

const UUID = '3f2b8c1e-9d4a-4b7e-8f10-2c5d6e7f8a9b';
const CURSOR_OK = encodeListCursor({ publishedAt: '2099-08-15T12:00:00.123456Z', id: UUID });

describe('T-04: rotulos por estado (CA-04)', () => {
  it('cada um dos quatro estados tem o rotulo esperado', () => {
    expect(REQUEST_STATUS_LABEL.publicado).toBe('Publicado');
    expect(REQUEST_STATUS_LABEL.selecionado).toBe('Profissional selecionado');
    expect(REQUEST_STATUS_LABEL.concluido).toBe('Concluído');
    expect(REQUEST_STATUS_LABEL.cancelado).toBe('Cancelado');
    expect([...REQUEST_STATUSES]).toEqual(['publicado', 'selecionado', 'concluido', 'cancelado']);
  });

  it('o prazo so aparece para pedido publicado; os demais estados ficam sem prazo (decisao 522)', () => {
    expect(panelItemLabels('publicado', 'aberto')).toEqual({ status: 'Publicado', prazo: 'Aceites abertos' });
    expect(panelItemLabels('publicado', 'encerrado')).toEqual({
      status: 'Publicado',
      prazo: 'Prazo de aceites encerrado',
    });
    expect(panelItemLabels('selecionado', null)).toEqual({ status: 'Profissional selecionado', prazo: null });
    expect(panelItemLabels('concluido', null)).toEqual({ status: 'Concluído', prazo: null });
    expect(panelItemLabels('cancelado', null)).toEqual({ status: 'Cancelado', prazo: null });
    expect(deadlineLabelOf('cancelado', 'aberto')).toBeNull();
    expect(DEADLINE_LABEL.aberto).toBe('Aceites abertos');
  });
});

describe('T-05: fronteira do prazo com relogio fixo (CA-05, parte pura em milissegundos)', () => {
  const prazo = Date.parse('2099-08-22T12:00:00.000Z');
  it('um instante antes do prazo e aberto', () => {
    expect(deadlineState(prazo - 1, prazo)).toBe('aberto');
  });
  it('no instante exato do prazo ja e encerrado', () => {
    expect(deadlineState(prazo, prazo)).toBe('encerrado');
  });
  it('depois do prazo continua encerrado', () => {
    expect(deadlineState(prazo + 1, prazo)).toBe('encerrado');
  });
  it('instante invalido nao decide estado', () => {
    expect(() => deadlineState(Number.NaN, prazo)).toThrow(RangeError);
  });
});

describe('T-06: chaves e textos sem contadores nem palavras proibidas (CA-06, RN-H034-03)', () => {
  const textos: string[] = [
    ...Object.values(PANEL_TEXT),
    ...Object.values(REQUEST_STATUS_LABEL),
    ...Object.values(DEADLINE_LABEL),
  ];
  it('a lista de chaves do item e a do desenho, na ordem', () => {
    expect([...PANEL_ITEM_KEYS]).toEqual([
      'id',
      'serviceName',
      'status',
      'prazo',
      'publishedAt',
      'acceptanceDeadlineAt',
    ]);
  });
  it('nenhuma chave proibida (contador, endereco, contato, descricao, dono) aparece no item', () => {
    const proibidas = [
      'acceptancesCount',
      'acceptances_count',
      'customerUserId',
      'customer_user_id',
      'addressText',
      'exactPoint',
      'email',
      'phone',
      'description',
      'publicLabel',
    ];
    for (const chave of proibidas) expect(PANEL_ITEM_KEYS as readonly string[]).not.toContain(chave);
  });
  it('nenhum texto da tela usa "vaga", "onda", nem o numero de limite em rotulo', () => {
    for (const texto of textos) {
      expect(texto.toLowerCase()).not.toMatch(/vaga|onda/);
      expect(texto).not.toMatch(/\b(4|8)\b/);
    }
  });
});

describe('T-09: texto da tela pos-publicacao (CA-09, decisao 465)', () => {
  it('e exatamente o texto aprovado, com prazo de 7 dias e a orientacao de voltar ao painel', () => {
    expect(PANEL_TEXT.posPublicacao).toBe(
      'Seu pedido foi publicado. Ele fica aberto para aceites por 7 dias. Para acompanhar, volte ao FastPro e abra Meus pedidos.',
    );
    expect(PANEL_TEXT.posPublicacao).toContain('7 dias');
    expect(PANEL_TEXT.posPublicacao).toContain('Meus pedidos');
  });
  it('nao traz termo tecnico nem numero de pedido', () => {
    for (const termo of ['uuid', 'id', 'api', 'erro', 'status', 'service_request', 'http']) {
      expect(PANEL_TEXT.posPublicacao.toLowerCase().split(/[^a-zà-ú_]+/)).not.toContain(termo);
    }
    expect(PANEL_TEXT.posPublicacao).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
  it('a sessao expirada nunca se confunde com lista vazia (R6, CA-02)', () => {
    expect(PANEL_TEXT.sessaoExpirada).not.toBe(PANEL_TEXT.vazio);
    expect(PANEL_TEXT.sessaoExpirada.toLowerCase()).not.toContain('sem pedidos');
  });
});

describe('cursor opaco da lista (CA-07, T-07 parte pura)', () => {
  it('a pagina tem 20 itens', () => {
    expect(REQUEST_LIST_PAGE_SIZE).toBe(20);
  });
  it('ida e volta preserva o instante com microssegundos e o id', () => {
    expect(parseListCursor(CURSOR_OK)).toEqual({ publishedAt: '2099-08-15T12:00:00.123456Z', id: UUID });
  });
  it('recusa vazio, curto, longo (121 caracteres) e alfabeto invalido', () => {
    expect(parseListCursor('')).toBeNull();
    expect(parseListCursor('ab')).toBeNull();
    expect(parseListCursor('a'.repeat(121))).toBeNull();
    expect(parseListCursor('abc+/=')).toBeNull();
  });
  it('recusa so a metade (data sem id), uuid invalido e data impossivel', () => {
    const soData = Buffer.from('2099-08-15T12:00:00.123456Z', 'utf8').toString('base64url');
    expect(parseListCursor(soData)).toBeNull();
    const uuidRuim = Buffer.from('2099-08-15T12:00:00.123456Z|nao-e-uuid', 'utf8').toString('base64url');
    expect(parseListCursor(uuidRuim)).toBeNull();
    const dataRuim = Buffer.from(`2099-13-45T12:00:00.123456Z|${UUID}`, 'utf8').toString('base64url');
    expect(parseListCursor(dataRuim)).toBeNull();
  });
});
