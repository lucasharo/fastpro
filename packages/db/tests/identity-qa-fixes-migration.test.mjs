// QA de banco (#29 e H-014): teste estatico das migracoes 20261111480000 (step_up nos CHECKs de
// app.auth_challenge) e 20261111490000 (NOINHERIT no papel de conexao de teste). Sem banco e sem rede:
// le o SQL. A prova no Postgres (T-H014-22, T-H012-20 e o desafio de step-up gravando) fica para o dbtest.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const norm = (t) => semComentario(t).toLowerCase().replace(/\s+/g, ' ');

const PURPOSE = norm(readFileSync(new URL('20261111480000_identity_restore_step_up_purpose.sql', MIGRATIONS), 'utf8'));
const PURPOSE_DOWN = norm(readFileSync(new URL('20261111480000_identity_restore_step_up_purpose.down.sql', ROLLBACKS), 'utf8'));
const ROLE = norm(readFileSync(new URL('20261111490000_platform_login_role_noinherit.sql', MIGRATIONS), 'utf8'));
const ROLE_DOWN = norm(readFileSync(new URL('20261111490000_platform_login_role_noinherit.down.sql', ROLLBACKS), 'utf8'));

describe('QA: step_up volta a ser aceito em app.auth_challenge (20261111480000)', () => {
  it('o CHECK de proposito inclui step_up e mantem os propositos do profissional', () => {
    expect(PURPOSE).toContain(
      "check (purpose in ('login', 'publish', 'step_up', 'professional_verify', 'password_reset', 'professional_activate'));",
    );
  });

  it('o codigo e obrigatorio para step_up e o usuario nao (o desafio pertence a sessao)', () => {
    expect(PURPOSE).toContain("check ((purpose in ('login', 'publish', 'step_up')) = (code_hmac is not null));");
    expect(PURPOSE).toContain("check (purpose in ('login', 'publish', 'step_up') or user_id is not null);");
  });

  it('nao remove colunas nem apaga linhas (so recria CHECKs)', () => {
    expect(PURPOSE).not.toContain('drop column');
    expect(PURPOSE).not.toMatch(/delete from/);
  });

  it('rollback apaga os desafios de step_up antes de restaurar os CHECKs de 400000, em transacao', () => {
    expect(PURPOSE_DOWN.indexOf("delete from app.auth_challenge where purpose = 'step_up';")).toBeLessThan(
      PURPOSE_DOWN.indexOf("check (purpose in ('login', 'publish', 'professional_verify', 'password_reset', 'professional_activate'));"),
    );
    expect(PURPOSE_DOWN).toContain("delete from ops.schema_migration where version = '20261111480000';");
    expect(PURPOSE_DOWN).toContain('begin;');
    expect(PURPOSE_DOWN).toContain('commit;');
  });
});

describe('QA: papel de conexao de teste sem heranca de app_system (20261111490000)', () => {
  it('aplica NOINHERIT ao papel de conexao, guardado pela existencia do papel', () => {
    expect(ROLE).toContain("if exists (select 1 from pg_roles where rolname = 'fastpro_system_login') then");
    expect(ROLE).toContain('alter role fastpro_system_login noinherit;');
  });

  it('nao revoga a membership nem cria papel', () => {
    expect(ROLE).not.toMatch(/revoke\b/);
    expect(ROLE).not.toMatch(/create role/);
  });

  it('rollback devolve a heranca e tira a migracao do registro', () => {
    expect(ROLE_DOWN).toContain('alter role fastpro_system_login inherit;');
    expect(ROLE_DOWN).toContain("delete from ops.schema_migration where version = '20261111490000';");
  });
});
