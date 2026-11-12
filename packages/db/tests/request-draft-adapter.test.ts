// H-025 | Adaptador Pg do rascunho com cliente falso, sem conexao real (docs/factory/74-DESENHO-H025.md, §2, §3, D-10).
// Prova: mapeamento de linha, parametros (so HMAC e hash, nunca IP ou segredo em claro), codigos de erro
// do banco e que o adaptador so chama funcoes private.draft_* e private.rl_* (sem escrita direta).
import { describe, expect, it } from 'vitest';
import {
  DRAFT_RATE_CRIACAO_HORA,
  DRAFT_RATE_SALVAR_IP,
  DRAFT_TTL_DAYS,
  type DraftCreateInput,
  type DraftPatchInput,
} from '@fastpro/domain';
import {
  PgDraftRate,
  PgDraftStore,
  SQL_DRAFT_CREATE,
  SQL_DRAFT_DISCARD,
  SQL_DRAFT_GET,
  SQL_DRAFT_PATCH,
  SQL_DRAFT_RL_CHECK,
  SQL_DRAFT_RL_HIT,
} from '../src/request-draft.js';
import type { SqlClient } from '../src/jobs-tick.js';

const HASH_SEGREDO = 'a'.repeat(64);
const HASH_IP = 'b'.repeat(64);
const AGORA = Date.UTC(2026, 10, 11, 12, 0, 0);
const AGORA_ISO = '2026-11-11T12:00:00.000Z';
const SERVICO = '0c9e2f7a-3b1d-4e8f-9a6b-1f2e3d4c5b6a';

type Resposta = Record<string, unknown>[] | Error;

/** Cliente falso: grava cada chamada e devolve a resposta enfileirada (ou levanta o erro). */
class FakeSql implements SqlClient {
  readonly chamadas: { text: string; params: unknown[] }[] = [];
  private readonly fila: Resposta[] = [];

  enfileira(...respostas: Resposta[]): void {
    this.fila.push(...respostas);
  }

  async query(text: string, params: unknown[] = []) {
    this.chamadas.push({ text, params });
    const r = this.fila.shift() ?? [];
    if (r instanceof Error) throw r;
    return { rows: r };
  }
}

/** Linha como a funcao private.draft_* a devolve (colunas out_*). */
const linha = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  out_id: '11111111-2222-4333-8444-555555555555',
  out_status: 'aberto',
  out_service_id: SERVICO,
  out_address_text: 'Rua Alfa, 10',
  out_urgency: 'imediato',
  out_description: 'Teste',
  out_expires_at: new Date(AGORA + DRAFT_TTL_DAYS * 86_400_000),
  out_updated_at: new Date(AGORA),
  ...over,
});

const erroBanco = (msg: string): Error => Object.assign(new Error(msg), { code: 'P0001' });

describe('leitura (private.draft_get)', () => {
  it('sem linha: null; chamada com o hash e o instante em ISO', async () => {
    const sql = new FakeSql();
    sql.enfileira([]);
    expect(await new PgDraftStore(sql).find(HASH_SEGREDO, AGORA)).toBeNull();
    expect(sql.chamadas[0]).toEqual({ text: SQL_DRAFT_GET, params: [HASH_SEGREDO, AGORA_ISO] });
  });

  it('linha: mapeia para o registro do dominio, com datas em ISO', async () => {
    const sql = new FakeSql();
    sql.enfileira([linha()]);
    const d = await new PgDraftStore(sql).find(HASH_SEGREDO, AGORA);
    expect(d).toEqual({
      id: '11111111-2222-4333-8444-555555555555',
      status: 'aberto',
      serviceId: SERVICO,
      addressText: 'Rua Alfa, 10',
      urgency: 'imediato',
      description: 'Teste',
      expiresAt: new Date(AGORA + DRAFT_TTL_DAYS * 86_400_000).toISOString(),
      updatedAt: AGORA_ISO,
    });
  });

  it('linha com estado fora dos quatro e erro interno (nao vaza para a resposta)', async () => {
    const sql = new FakeSql();
    sql.enfileira([linha({ out_status: 'qualquer' })]);
    await expect(new PgDraftStore(sql).find(HASH_SEGREDO, AGORA)).rejects.toThrow('rascunho_resposta_invalida');
  });
});

describe('criacao (private.draft_create)', () => {
  const entrada: DraftCreateInput = {
    secretHash: HASH_SEGREDO,
    ipHmac: HASH_IP,
    nowMs: AGORA,
    expiredSecretHash: null,
    fields: { urgency: 'imediato' },
  };

  it('passa hash, HMAC do IP, prazo em dias, sem cookie vencido e os campos como JSON', async () => {
    const sql = new FakeSql();
    sql.enfileira([linha()]);
    const r = await new PgDraftStore(sql).create(entrada);
    expect(r.ok).toBe(true);
    expect(sql.chamadas[0]).toEqual({
      text: SQL_DRAFT_CREATE,
      params: [HASH_SEGREDO, HASH_IP, AGORA_ISO, DRAFT_TTL_DAYS, null, '{"urgency":"imediato"}'],
    });
  });

  it('cookie vencido: passa o hash dele para ser marcado como descartado', async () => {
    const sql = new FakeSql();
    sql.enfileira([linha()]);
    await new PgDraftStore(sql).create({ ...entrada, expiredSecretHash: 'c'.repeat(64) });
    expect(sql.chamadas[0]?.params[4]).toBe('c'.repeat(64));
  });

  it('servico inativo ou inexistente: codigo servico_invalido, sem levantar erro', async () => {
    const sql = new FakeSql();
    sql.enfileira(erroBanco('servico_invalido'));
    expect(await new PgDraftStore(sql).create(entrada)).toEqual({ ok: false, code: 'servico_invalido' });
  });

  it('erro do banco que nao e codigo conhecido sobe como erro (o servico responde 503)', async () => {
    const sql = new FakeSql();
    sql.enfileira(erroBanco('draft_entrada_invalida'));
    await expect(new PgDraftStore(sql).create(entrada)).rejects.toThrow('draft_entrada_invalida');
  });

  it('criacao sem linha de retorno e erro interno', async () => {
    const sql = new FakeSql();
    sql.enfileira([]);
    await expect(new PgDraftStore(sql).create(entrada)).rejects.toThrow('rascunho_criacao_sem_linha');
  });
});

describe('salvamento (private.draft_patch) e descarte (private.draft_discard)', () => {
  const entrada: DraftPatchInput = { secretHash: HASH_SEGREDO, nowMs: AGORA, fields: { description: null } };

  it('sem linha vivo: nao_encontrado (mesmo codigo para inexistente, vencido, descartado)', async () => {
    const sql = new FakeSql();
    sql.enfileira([]);
    expect(await new PgDraftStore(sql).patch(entrada)).toEqual({ ok: false, code: 'nao_encontrado' });
    expect(sql.chamadas[0]).toEqual({
      text: SQL_DRAFT_PATCH,
      params: [HASH_SEGREDO, AGORA_ISO, DRAFT_TTL_DAYS, '{"description":null}'],
    });
  });

  it('servico invalido no salvamento: codigo servico_invalido', async () => {
    const sql = new FakeSql();
    sql.enfileira(erroBanco('servico_invalido'));
    expect(await new PgDraftStore(sql).patch(entrada)).toEqual({ ok: false, code: 'servico_invalido' });
  });

  it('salvamento aceito: registro do dominio', async () => {
    const sql = new FakeSql();
    sql.enfileira([linha({ out_description: null })]);
    const r = await new PgDraftStore(sql).patch(entrada);
    expect(r.ok && r.draft.description).toBeNull();
  });

  it('descarte: verdadeiro so quando havia rascunho vivo', async () => {
    const sql = new FakeSql();
    sql.enfileira([{ ok: true }], [{ ok: false }], [{ ok: null }]);
    const store = new PgDraftStore(sql);
    expect(await store.discard(HASH_SEGREDO, AGORA)).toBe(true);
    expect(await store.discard(HASH_SEGREDO, AGORA)).toBe(false);
    expect(await store.discard(HASH_SEGREDO, AGORA)).toBe(false);
    expect(sql.chamadas[0]).toEqual({ text: SQL_DRAFT_DISCARD, params: [HASH_SEGREDO, AGORA_ISO] });
  });
});

describe('limite de taxa (private.rl_check e private.rl_hit)', () => {
  it('chave prefixada pela politica e o HMAC; janela e limite da politica', async () => {
    const sql = new FakeSql();
    sql.enfileira([{ out_ok: true, out_retry_after: null }]);
    const r = await new PgDraftRate(sql).check(DRAFT_RATE_CRIACAO_HORA, HASH_IP, AGORA);
    expect(r).toEqual({ ok: true });
    expect(sql.chamadas[0]).toEqual({
      text: SQL_DRAFT_RL_CHECK,
      params: [`draft:criacao_hora:${HASH_IP}`, 3600, 300, 10, AGORA_ISO],
    });
  });

  it('barrado: devolve o Retry-After do banco', async () => {
    const sql = new FakeSql();
    sql.enfileira([{ out_ok: false, out_retry_after: 1234 }]);
    expect(await new PgDraftRate(sql).check(DRAFT_RATE_SALVAR_IP, HASH_IP, AGORA)).toEqual({
      ok: false,
      retryAfterS: 1234,
    });
  });

  it('resposta do banco sem o campo booleano: erro (nao libera o pedido por engano)', async () => {
    const sql = new FakeSql();
    sql.enfileira([{ out_retry_after: 3 }]);
    await expect(new PgDraftRate(sql).check(DRAFT_RATE_SALVAR_IP, HASH_IP, AGORA)).rejects.toThrow('rl_resposta_invalida');
  });

  it('hit: conta com o balde da politica, so depois do aceite (quem chama decide)', async () => {
    const sql = new FakeSql();
    sql.enfileira([]);
    await new PgDraftRate(sql).hit(DRAFT_RATE_CRIACAO_HORA, HASH_IP, AGORA);
    expect(sql.chamadas[0]).toEqual({
      text: SQL_DRAFT_RL_HIT,
      params: [`draft:criacao_hora:${HASH_IP}`, 300, AGORA_ISO],
    });
  });
});

describe('sem escrita direta na tabela', () => {
  it('toda instrucao do adaptador chama uma funcao private.*; nenhuma toca app.request_draft', () => {
    const sqls = [SQL_DRAFT_GET, SQL_DRAFT_CREATE, SQL_DRAFT_PATCH, SQL_DRAFT_DISCARD, SQL_DRAFT_RL_CHECK, SQL_DRAFT_RL_HIT];
    for (const s of sqls) {
      expect(s).toMatch(/private\.(draft_\w+|rl_check|rl_hit)\(/);
      expect(s).not.toMatch(/app\.request_draft/);
      expect(s).not.toMatch(/\b(insert|update|delete)\b/i);
    }
  });
});
