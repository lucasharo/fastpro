// H-016 | Teste estatico da migracao do cadastro e do login do profissional
// (docs/factory/33-DESENHO-H016.md §2 a §5; docs/factory/67-DESENHO-H016.md §6). Sem banco e sem rede:
// le o SQL. A prova no Postgres (CHECKs, funcoes, contador, concorrencia) fica no teste de banco
// (dbtest), que roda so quando o banco de desenvolvimento for usado. Executar: pnpm test (vitest).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111400000_identity_create_professional_account.sql';
const DOWN = '20261111400000_identity_create_professional_account.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = semComentario(readFileSync(new URL(FILE, MIGRATIONS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');

const FUNCOES = [
  'private.professional_login_wait',
  'private.professional_register_create',
  'private.professional_verify_confirm',
  'private.professional_login_gate',
  'private.professional_login_success',
  'private.professional_account_by_email',
  'private.professional_session_open',
];

describe('T-H016-MIG perfil do profissional (CA-H016-01, CA-H016-21, CA-H016-22)', () => {
  it('cria professional_profile com status inicial pendente e os seis estados do desenho', () => {
    expect(sql).toContain('create table if not exists app.professional_profile');
    expect(sql).toContain("verification_status text not null default 'pendente'");
    for (const estado of ['pendente', 'em_revisao', 'aprovada', 'retida_duplicidade', 'recusada', 'suspensa']) {
      expect(sql).toContain(`'${estado}'`);
    }
  });

  it('RLS habilitada e forcada, sem politica, e so app_system recebe privilegio', () => {
    expect(sql).toContain('alter table app.professional_profile enable row level security;');
    expect(sql).toContain('alter table app.professional_profile force row level security;');
    expect(sql).toMatch(/revoke all on app.professional_profile from public, anon, authenticated, [a-z_]+;/);
    expect(sql).toContain('grant select, insert, update, delete on app.professional_profile to app_system;');
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/to app_api/);
  });
});

describe('T-H016-MIG auth_challenge (67 §6, item A)', () => {
  it('aceita os tres propositos novos e exige user_id para eles', () => {
    expect(sql).toContain(
      "check (purpose in ('login', 'publish', 'professional_verify', 'password_reset', 'professional_activate'));",
    );
    expect(sql).toContain("check (purpose in ('login', 'publish') or user_id is not null);");
  });

  it('code_hmac so e obrigatorio para login e publicacao', () => {
    expect(sql).toContain('alter table app.auth_challenge alter column code_hmac drop not null;');
    expect(sql).toContain('check ((purpose in (\'login\', \'publish\')) = (code_hmac is not null));');
  });

  it('nao remove colunas nem apaga linhas (expand)', () => {
    expect(sql).not.toContain('drop column');
    expect(sql).not.toMatch(/delete from app\./);
  });
});

describe('T-H016-MIG funcoes do cadastro, verificacao e login', () => {
  it('declara todas as funcoes com search_path vazio', () => {
    for (const f of FUNCOES) {
      expect(sql).toContain(`${f}(`);
    }
    expect(sql.match(/set search_path = ''/g)?.length).toBe(FUNCOES.length);
  });

  it('o link de verificacao vale 15 min e e consumido por UPDATE atomico', () => {
    expect(sql).toContain("p_now + interval '15 minutes', p_now, 0);");
    expect(sql).toContain('where c.token_hash = p_token_hash');
    expect(sql).toContain("and c.purpose = 'professional_verify'");
    expect(sql).toContain('and c.consumed_at is null');
    expect(sql).toContain('and c.expires_at > p_now');
  });

  it('a espera do login segue 30 s dobrando, sem espera ate a 4a falha, teto de 900 s', () => {
    expect(sql).toContain('when p_proximo <= 4 then 0 else least(900, 30 * power(2, p_proximo - 5))::integer end');
  });

  it('a sessao por senha nasce ativa, com prova recente e prazo de 7 dias', () => {
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain("values (p_session_id, p_user_id, 'ativa', p_secret_hash, null, 'password', null,");
    expect(sql).toContain("p_now, v_fim, v_fim, p_now, 'password');");
  });

  it('so app_system executa as funcoes', () => {
    expect(sql).toContain('to app_system;');
    expect(sql).not.toMatch(/grant execute on function[^;]*to (anon|authenticated|public|[a-z]+_role)/);
  });
});

describe('T-H016-MIG rollback de 20261111400000', () => {
  it('remove as funcoes, restaura o CHECK e tira a migracao do registro, em transacao', () => {
    for (const f of FUNCOES) {
      expect(rb).toContain(`drop function if exists ${f}(`);
    }
    expect(rb).toContain("check (purpose in ('login', 'publish'));");
    expect(rb).toContain('alter table app.auth_challenge alter column code_hmac set not null;');
    expect(rb).toContain('drop table if exists app.professional_profile;');
    expect(rb).toContain("delete from ops.schema_migration where version = '20261111400000';");
    expect(rb.indexOf('begin;')).toBeLessThan(rb.indexOf('commit;'));
  });
});
