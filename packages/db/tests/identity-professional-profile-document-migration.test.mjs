// H-035 | Teste estatico da migracao do documento do profissional (docs/factory/75-DESENHO-H035.md §1, §2;
// CA-05, CA-06, CA-08). Sem banco e sem rede: le o SQL. A prova no Postgres (indice parcial, corrida de
// dois cadastros, rollback) fica no teste de banco (dbtest), que roda so com o banco de desenvolvimento.
// Executar: vitest (pnpm test) ou node --test em packages/db.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url);
const ROLLBACKS = new URL('../../../supabase/rollbacks/', import.meta.url);
const FILE = '20261111420000_identity_professional_profile_document.sql';
const DOWN = '20261111420000_identity_professional_profile_document.down.sql';

const semComentario = (texto) =>
  texto
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');
const sql = semComentario(readFileSync(new URL(FILE, MIGRATIONS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');
const rb = semComentario(readFileSync(new URL(DOWN, ROLLBACKS), 'utf8')).toLowerCase().replace(/\s+/g, ' ');

describe('T-H035-MIG colunas novas do perfil (75 §1)', () => {
  it('acrescenta as cinco colunas, sem remover nem alterar coluna existente', () => {
    expect(sql).toContain('add column if not exists public_name text');
    expect(sql).toContain('add column if not exists slug text');
    expect(sql).toContain('add column if not exists document_type text');
    expect(sql).toContain('add column if not exists document_enc bytea');
    expect(sql).toContain('add column if not exists document_hmac text');
    expect(sql).not.toMatch(/drop column/);
    expect(sql).not.toMatch(/alter column/);
  });

  it('nao guarda numero em claro: nenhuma coluna chamada cpf ou cnpj', () => {
    expect(sql).not.toMatch(/add column[^;]*\b(cpf|cnpj|document_number|document_text)\b/);
  });
});

describe('T-H035-MIG CHECKs (CA-08 e formato)', () => {
  it('tipo do documento so aceita CPF e CNPJ', () => {
    expect(sql).toContain("check (document_type is null or document_type in ('cpf', 'cnpj'))");
  });

  it('os tres campos do documento: todos nulos ou todos preenchidos', () => {
    expect(sql).toContain(
      'check ((document_type is null and document_enc is null and document_hmac is null) or (document_type is not null and document_enc is not null and document_hmac is not null))',
    );
  });

  it('HMAC em hexadecimal de 64 caracteres minusculos', () => {
    expect(sql).toContain("check (document_hmac is null or document_hmac ~ '^[0-9a-f]{64}$')");
  });

  it('nome publico com 2 a 80 caracteres sem espaco nas bordas; nome e slug entram junto com o documento', () => {
    expect(sql).toContain('char_length(public_name) between 2 and 80');
    expect(sql).toContain('public_name = btrim(public_name)');
    expect(sql).toContain('check ((public_name is null) = (document_type is null)');
    expect(sql).toContain('and (slug is null) = (document_type is null));');
  });
});

describe('T-H035-MIG indice unico parcial (CA-05, CA-06)', () => {
  it('unicidade do HMAC exclui recusada e retida_duplicidade', () => {
    expect(sql).toContain('create unique index if not exists professional_profile_document_hmac_vivo_key');
    expect(sql).toContain('on app.professional_profile (document_hmac)');
    expect(sql).toContain('where document_hmac is not null');
    expect(sql).toContain("and verification_status not in ('recusada', 'retida_duplicidade');");
  });

  it('slug unico apenas onde preenchido', () => {
    expect(sql).toContain('create unique index if not exists professional_profile_slug_key');
    expect(sql).toContain('on app.professional_profile (slug)');
    expect(sql).toContain('where slug is not null;');
  });

  it('o indice nao mexe em verification_status: nao cria estado novo', () => {
    expect(sql).not.toMatch(/check \(verification_status/);
    expect(sql).not.toMatch(/verification_status in \('(pendente|aprovada|em_revisao)'\) *\)/);
  });
});

describe('T-H035-MIG evento de auditoria (D6)', () => {
  it('registra professional.document_duplicate no catalogo, sem PII (so ids)', () => {
    expect(sql).toContain('insert into audit.action_catalog');
    expect(sql).toContain("('professional.document_duplicate', 'professional_profile', false,");
    expect(sql).toContain("array['verification_status', 'user_id_existente']");
    expect(sql).toContain('on conflict (action) do nothing;');
  });
});

describe('T-H035-MIG expand e idempotencia', () => {
  it('nao apaga linhas e nao cria politica de RLS nem papel novo', () => {
    expect(sql).not.toMatch(/delete from/);
    expect(sql).not.toMatch(/create policy/);
    expect(sql).not.toMatch(/create role/);
  });

  it('nao concede privilegio nem altera grant (pendencia registrada no desenho)', () => {
    expect(sql).not.toMatch(/\bgrant\b/);
    expect(sql).not.toMatch(/\brevoke\b/);
  });

  it('cada CHECK e indice e recriado com drop if exists antes (rodar de novo nao falha)', () => {
    for (const nome of [
      'professional_profile_documento_tipo',
      'professional_profile_documento_completo',
      'professional_profile_documento_hmac_formato',
      'professional_profile_nome_publico_formato',
      'professional_profile_cadastro_junto',
      'professional_profile_slug_formato',
    ]) {
      expect(sql).toContain(`drop constraint if exists ${nome};`);
    }
  });
});

describe('T-H035-MIG rollback de 20261111420000', () => {
  it('em transacao, recusa rodar com documento cifrado gravado', () => {
    expect(rb.indexOf('begin;')).toBeLessThan(rb.indexOf('commit;'));
    expect(rb).toContain('where document_enc is not null');
    expect(rb).toContain('rollback_bloqueado_ha_documentos_cifrados');
  });

  it('remove indices, CHECKs, colunas e o tipo de evento, e tira a migracao do registro', () => {
    expect(rb).toContain('drop index if exists app.professional_profile_document_hmac_vivo_key;');
    expect(rb).toContain('drop index if exists app.professional_profile_slug_key;');
    expect(rb).toContain('drop column if exists document_hmac;');
    expect(rb).toContain('drop column if exists document_enc;');
    expect(rb).toContain('drop column if exists document_type;');
    expect(rb).toContain('drop column if exists slug;');
    expect(rb).toContain('drop column if exists public_name;');
    expect(rb).toContain("delete from audit.action_catalog where action = 'professional.document_duplicate';");
    expect(rb).toContain("delete from ops.schema_migration where version = '20261111420000';");
    for (const nome of [
      'professional_profile_documento_tipo',
      'professional_profile_documento_completo',
      'professional_profile_documento_hmac_formato',
      'professional_profile_nome_publico_formato',
      'professional_profile_cadastro_junto',
      'professional_profile_slug_formato',
    ]) {
      expect(rb).toContain(`drop constraint if exists ${nome};`);
    }
  });
});
