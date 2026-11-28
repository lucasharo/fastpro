// Issue 47 (H-034) | Teste estatico da migracao do painel do cliente (docs/factory/133-DESENHO-H034.md, §3, §8; T-15, T-16).
// Confere o texto da migracao e da reversao sem banco: nome e prefixo, expansao sem tabela nem dado, privilegios e colunas.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const NOME = '20261113430000_requests_expand_customer_panel';
const MIG = readFileSync(new URL(`../../../supabase/migrations/${NOME}.sql`, import.meta.url), 'utf8');
const DOWN = readFileSync(new URL(`../../../supabase/rollbacks/${NOME}.down.sql`, import.meta.url), 'utf8');
const SQL = MIG.toLowerCase();
const FUNCAO = 'private.request_list_owner(uuid, timestamptz, timestamptz, uuid, integer)';

/** Parte de saida da funcao: do "returns table" ate o "language". */
const SAIDA = SQL.slice(SQL.indexOf('returns table'), SQL.indexOf('language plpgsql'));

describe('nome, prefixo e arquivos (T-16)', () => {
  it('o prefixo e maior que o da #46 (20261113250000) e nenhuma outra migracao usa o mesmo prefixo', () => {
    // Migracoes de issues posteriores entram depois desta; o teste nao exige mais ser o arquivo mais novo.
    const prefixo = NOME.slice(0, 14);
    expect(prefixo > '20261113250000').toBe(true);
    const existentes = readdirSync(new URL('../../../supabase/migrations/', import.meta.url))
      .filter((f) => f.endsWith('.sql') && f !== `${NOME}.sql`)
      .map((f) => f.slice(0, 14));
    expect(existentes.filter((p) => p === prefixo)).toEqual([]);
  });
  it('a reversao existe com o mesmo nome base', () => {
    expect(DOWN.length).toBeGreaterThan(0);
    expect(DOWN.toLowerCase()).toContain('drop function if exists ' + FUNCAO);
  });
});

describe('expansao sem tabela, coluna nem dado (desenho §3.2, passo 5)', () => {
  it('nao cria nem altera tabela, coluna ou dado', () => {
    for (const proibido of ['create table', 'alter table', 'drop table', 'drop column', 'add column', 'insert into', 'update ', 'delete from']) {
      expect(SQL).not.toContain(proibido);
    }
  });
  it('o indice e idempotente e tem a ordem do cursor', () => {
    expect(SQL).toContain('create index if not exists service_request_cliente_recente_idx');
    expect(SQL).toContain('on app.service_request (customer_user_id, published_at desc, id desc)');
  });
  it('a guarda de pre-requisito levanta erro fixo', () => {
    expect(SQL).toContain("raise exception 'painel_pre_requisito_ausente'");
  });
});

describe('funcao de lista: catalogo e corpo (CA-16, T-15 estatico)', () => {
  it('e security definer, search_path vazio e lock_timeout', () => {
    expect(SQL).toContain('security definer');
    expect(SQL).toContain("set search_path = ''");
    expect(SQL).toContain("set lock_timeout = '5s'");
  });
  it('a saida nao tem coluna de endereco, contato, coordenada, dono, contador, match, descricao nem nome', () => {
    for (const proibida of ['address', 'public_label', 'exact_point', 'geocode', 'email', 'phone', 'customer_user_id', 'acceptances', 'match_', 'description', 'urgency', 'first_name']) {
      expect(SAIDA).not.toContain(proibida);
    }
  });
  it('o corpo nao toca em exact_point, endereco, e-mail nem telefone', () => {
    const corpo = SQL.slice(SQL.indexOf('return query'));
    for (const proibido of ['exact_point', 'address_text', 'email', 'phone']) expect(corpo).not.toContain(proibido);
  });
  it('o cursor usa microssegundos no texto e a ordem published_at, id desc', () => {
    expect(SQL).toContain(".us\"z\"");
    expect(SQL).toContain('order by r.published_at desc, r.id desc');
    expect(SQL).toContain('limit p_limit');
  });
  it('limite entre 1 e 21 e cursor so com os dois campos ou nenhum', () => {
    expect(SQL).toContain('p_limit > 21');
    expect(SQL).toContain('(p_after_published_at is null) <> (p_after_id is null)');
  });
});

describe('privilegios (T-15 estatico)', () => {
  it('revoga de todos e concede execute so a app_system', () => {
    expect(SQL).toContain(`revoke all on function ${FUNCAO}`);
    const concessoes = [...SQL.matchAll(/grant execute on function private\.request_list_owner\(([^)]*)\) to ([a-z_]+);/g)];
    expect(concessoes.map((m) => m[2])).toEqual(['app_system']);
  });
});

describe('reversao', () => {
  it('remove a funcao e o indice novo, sem tocar o indice antigo', () => {
    const d = DOWN.toLowerCase();
    expect(d).toContain('drop index if exists app.service_request_cliente_recente_idx');
    expect(d).not.toContain('service_request_cliente_idx');
    expect(d).toContain(`delete from ops.schema_migration where version = '${NOME.slice(0, 14)}'`);
  });
});
