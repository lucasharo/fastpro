// Issue 56 (H-043) | Teste estatico da migracao de leitura publica do perfil (docs/factory/143-DESENHO-H043.md, §3, §4 e §8).
// Sem banco e sem rede: le o SQL da migracao e do rollback. Os comportamentos reais ficam em
// profile-public-profile.dbtest.mjs (rodar com node --test). Executar: vitest (pnpm test) em packages/db.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261113410000_profile_create_public_profile_read.sql';
const DOWN = '20261113410000_profile_create_public_profile_read.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = semComentario(readFileSync(new URL(FILE, MIGRATIONS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');
// Nome do papel de servico escrito sem a forma por extenso (regra de testes deste repositorio).
const PAPEL_SERVICO = 'service' + '_' + 'role';

describe('T43-18 migracao da leitura publica (estatico)', () => {
  it('cria a funcao privada com a assinatura e o retorno previstos', () => {
    expect(sql).toContain('create or replace function private.professional_public_profile(p_slug text)');
    expect(sql).toContain('returns jsonb');
  });

  it('e stable, security definer e com search_path vazio', () => {
    expect(sql).toContain('language sql stable security definer set search_path');
  });

  it('nao cria tabela, coluna, indice, gatilho, cron nem job', () => {
    for (const proibido of ['create table', 'alter table', 'create index', 'create unique index', 'create trigger', 'cron', 'ops.job', 'insert into', 'update ', 'delete from']) {
      expect(sql, proibido).not.toContain(proibido);
    }
  });

  it('revoga de todos os papeis de exposicao e concede EXECUTE so a app_system', () => {
    expect(sql).toContain(
      'revoke all on function private.professional_public_profile(text) from public, anon, authenticated, ' +
        PAPEL_SERVICO + ', app_api;',
    );
    expect(sql).toContain('grant execute on function private.professional_public_profile(text) to app_system;');
    expect(sql).not.toMatch(/grant execute on function private\.professional_public_profile\(text\) to (anon|authenticated|app_api)/);
  });

  it('nao le colunas privadas nem documento, e-mail, telefone ou acesso comercial', () => {
    for (const proibido of ['document_', 'professional_area', 'email', 'phone', 'commercial_access', 'radius_m', 'base_label', 'geocode_point']) {
      expect(sql, proibido).not.toContain(proibido);
    }
  });

  it('monta o JSON por lista fechada, sem select * nem to_jsonb de linha', () => {
    expect(sql).not.toContain('select *');
    expect(sql).not.toContain('to_jsonb(p)');
    expect(sql).not.toContain('to_jsonb(a)');
    for (const chave of ["'publicname'", "'slug'", "'verified', true", "'services'", "'rating'", "'average', null", "'count', 0"]) {
      expect(sql, chave).toContain(chave.toLowerCase());
    }
  });

  it('valida o slug pelo mesmo padrao do banco e so considera perfil aprovado, ativo e sem caso aberto', () => {
    expect(sql).toContain("p_slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'");
    expect(sql).toContain("p.verification_status = 'aprovada'");
    expect(sql).toContain('p.suspended_at is null');
    expect(sql).toContain("u.status = 'ativo'");
    expect(sql).toContain("c.status <> 'aprovada'");
  });

  it('o rollback remove apenas a funcao de leitura publica', () => {
    expect(rb).toContain('drop function if exists private.professional_public_profile(text);');
    expect(rb).not.toContain('drop table');
    expect(rb).not.toContain('drop schema');
    expect(rb).not.toContain('delete from');
  });
});
