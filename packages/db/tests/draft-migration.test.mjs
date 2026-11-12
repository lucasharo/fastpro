// H-025 | Teste estatico da migracao app.request_draft (docs/factory/74-DESENHO-H025.md, §2, D-05, D-06, D-10).
// Sem banco e sem rede: le o SQL e confere postura (RLS forcada), ausencia de coordenada e de dado pessoal,
// privilegios (sem grant extra), funcoes security definer com search_path vazio e o arquivo de desfazer.
// Executar: pnpm test (vitest). A aplicacao no banco e o teste de comportamento ficam para a etapa de banco.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111440000_draft_create_request_draft.sql';
const DOWN = '20261111440000_draft_create_request_draft.down.sql';

const raw = readFileSync(new URL(FILE, MIGRATIONS), 'utf8');
const down = readFileSync(new URL(DOWN, ROLLBACKS), 'utf8');
// Codigo SQL sem linhas de comentario (os cabecalhos citam nomes e regras de proposito).
const code = (s) =>
  s
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = code(raw);
const lower = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const tabela = sql.slice(sql.indexOf('create table if not exists app.request_draft'), sql.indexOf(');', sql.indexOf('create table if not exists app.request_draft')));
const FUNCOES = [
  'private.draft_get(text, timestamptz)',
  'private.draft_create(text, text, timestamptz, integer, text, jsonb)',
  'private.draft_patch(text, timestamptz, integer, jsonb)',
  'private.draft_discard(text, timestamptz)',
];

describe('T-H025-10 estatico da migracao app.request_draft', () => {
  it('cria a tabela de forma idempotente, com as colunas do modelo e os CHECKs de estado e tamanho', () => {
    expect(lower(sql)).toContain('create table if not exists app.request_draft');
    for (const c of ['browser_nonce_hash', 'service_id', 'address_text', 'urgency', 'description', 'status', 'expires_at', 'ip_hmac', 'created_at', 'updated_at']) {
      expect(tabela).toMatch(new RegExp(`\\b${c}\\b`));
    }
    expect(tabela).toContain("'aberto', 'aguardando_email', 'descartado', 'publicado'");
    expect(tabela).toMatch(/char_length\(address_text\) between 3 and 200/);
    expect(tabela).toMatch(/char_length\(description\) between 1 and 2000/);
    expect(tabela).toMatch(/'imediato', 'proximas_semanas', 'proximo_mes', 'nao_definido'/);
  });

  it('D-05 sem coordenada: nenhuma coluna de latitude, longitude, ponto ou geometria', () => {
    expect(tabela).not.toMatch(/\b(lat|lon|latitude|longitude|point|geom|geometry|geography|exact_point)\b/i);
    expect(sql).not.toMatch(/extensions\.(geography|geometry)/i);
  });

  it('R2 sem dado pessoal: nenhuma coluna de e-mail, nome, telefone ou documento', () => {
    expect(tabela).not.toMatch(/\b(email|first_name|phone|telefone|cpf|cnpj|document)\b/i);
  });

  it('D-10 RLS habilitada e forcada na tabela', () => {
    expect(lower(sql)).toContain('alter table app.request_draft enable row level security;');
    expect(lower(sql)).toContain('alter table app.request_draft force row level security;');
  });

  it('D-10 sem politica de linha: nenhuma create policy', () => {
    expect(sql).not.toMatch(/\bcreate\s+policy\b/i);
  });

  it('D-10 privilegios: revoke total na tabela para PUBLIC, anon, authenticated, service_role e papeis de API e de backup', () => {
    expect(lower(sql)).toContain(
      'revoke all on app.request_draft from public, anon, authenticated, service_role, app_api, app_system, app_backup_reader;',
    );
  });

  it('D-10 sem grant extra: a unica concessao e EXECUTE das quatro funcoes para app_api', () => {
    const grants = [...sql.matchAll(/\bgrant\b[^;]*;/gi)].map((m) => lower(m[0]));
    expect(grants).toHaveLength(FUNCOES.length);
    for (const f of FUNCOES) {
      expect(grants).toContain(`grant execute on function ${f.toLowerCase()} to app_api;`);
    }
    expect(grants.some((g) => /\bon table\b|app\.request_draft/.test(g))).toBe(false);
    expect(grants.some((g) => /\b(public|anon|authenticated|service_role)\b\s*;/.test(g))).toBe(false);
  });

  it('D-10 cada funcao tem revoke de PUBLIC, anon, authenticated e service_role antes do grant', () => {
    const revokes = [...sql.matchAll(/\brevoke\s+all\s+on\s+function\b[^;]*;/gi)].map((m) => lower(m[0]));
    expect(revokes).toHaveLength(FUNCOES.length);
    for (const f of FUNCOES) {
      expect(revokes).toContain(
        `revoke all on function ${f.toLowerCase()} from public, anon, authenticated, service_role;`,
      );
    }
  });

  it('D-10 cada funcao e security definer com search_path vazio', () => {
    const blocos = sql.split(/create or replace function /i).slice(1);
    expect(blocos).toHaveLength(FUNCOES.length);
    for (const b of blocos) {
      const cabeca = b.slice(0, b.indexOf('as $$'));
      expect(lower(cabeca)).toContain("security definer");
      expect(lower(cabeca)).toContain("set search_path = ''");
    }
  });

  it('as quatro funcoes existem com esse nome (escrita e leitura so por funcao)', () => {
    for (const f of FUNCOES) {
      const nome = f.slice(0, f.indexOf('('));
      expect(sql).toMatch(new RegExp(`create or replace function ${nome.replace('.', '\\.')}\\(`));
    }
  });

  it('D-06 nao cria service_request nem marca rascunho como publicado', () => {
    expect(sql).not.toMatch(/service_request/i);
    expect(sql).not.toMatch(/set\s+status\s*=\s*'publicado'/i);
  });

  it('sem log de valores: nenhum raise notice, log, info ou warning', () => {
    expect(sql).not.toMatch(/\braise\s+(notice|log|info|warning|debug)\b/i);
  });

  it('T-H025-10 o expurgo e a leitura sao so por prazo: a funcao de leitura exige status vivo e prazo nao vencido', () => {
    const leitura = sql.slice(sql.indexOf('function private.draft_get'), sql.indexOf('$$;', sql.indexOf('function private.draft_get')));
    expect(lower(leitura)).toContain("r.status in ('aberto', 'aguardando_email')");
    expect(lower(leitura)).toContain('r.expires_at > p_now');
  });

  it('D-10 teto de 30 dias e prazo de 1 a 30 dias na escrita', () => {
    const patch = sql.slice(sql.indexOf('function private.draft_patch'), sql.indexOf('$$;', sql.indexOf('function private.draft_patch')));
    expect(lower(patch)).toContain("least(p_now + make_interval(days => p_ttl_days), r.created_at + interval '30 days')");
    expect(sql).toMatch(/p_ttl_days < 1 or p_ttl_days > 30/);
  });

  it('idempotencia: indice unico parcial de um rascunho vivo por segredo, e indices de expurgo e de limite', () => {
    expect(lower(sql)).toContain(
      "create unique index if not exists request_draft_nonce_vivo_key on app.request_draft (browser_nonce_hash) where status in ('aberto', 'aguardando_email')",
    );
    expect(lower(sql)).toContain('create index if not exists request_draft_expires_at_idx on app.request_draft (expires_at)');
    expect(lower(sql)).toContain('create index if not exists request_draft_ip_created_idx on app.request_draft (ip_hmac, created_at)');
  });

  it('servico precisa estar ativo na criacao e no salvamento', () => {
    expect(sql.match(/s\.active/g) ?? []).toHaveLength(2);
    expect(sql).toMatch(/raise exception 'servico_invalido'/);
  });

  it('arquivo de desfazer: remove funcoes, tabela e o registro da versao, sem tocar em app.service', () => {
    const d = lower(code(down));
    for (const f of FUNCOES) {
      expect(d).toContain(`drop function if exists ${f.toLowerCase()};`);
    }
    expect(d).toContain('drop table if exists app.request_draft;');
    expect(d).toContain("delete from ops.schema_migration where version = '20261111440000';");
    expect(d).not.toMatch(/app\.service|rl_check|rl_hit/);
    expect(d).toMatch(/^begin;/);
    expect(d).toMatch(/commit;\s*$/);
  });
});
