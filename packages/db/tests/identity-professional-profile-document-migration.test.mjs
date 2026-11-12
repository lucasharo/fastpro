// H-035 | Teste estatico da migracao do documento do profissional (docs/factory/75-DESENHO-H035.md §1, §2, §4;
// decisao 54 em 11-DECISOES.md; CA-05, CA-06, CA-08, CA-11). Sem banco e sem rede: le o SQL. As mesmas regras
// sao descritas para o banco em identity-professional-profile-document.dbtest.mjs (nao rodam aqui).
// Executar: vitest (pnpm test) em packages/db.
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

// Trechos por funcao: o gatilho e a funcao de gravacao, cada um do seu inicio ao proximo marco.
const trechoGatilho = sql.slice(
  sql.indexOf('create or replace function private.professional_profile_guard_update'),
  sql.indexOf('create or replace function private.professional_profile_set_document'),
);
const trechoFuncao = sql.slice(sql.indexOf('create or replace function private.professional_profile_set_document'));

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

  it('o indice nao cria estado novo de verification_status', () => {
    expect(sql).not.toMatch(/check \(verification_status/);
  });
});

describe('T-H035-MIG privilegios por coluna (decisao 54, item 1)', () => {
  it('app_system recebe update somente nas colunas do documento, verification_status e updated_at', () => {
    expect(sql).toContain(
      'grant update (public_name, slug, document_type, document_enc, document_hmac, verification_status, updated_at) on app.professional_profile to app_system;',
    );
  });

  it('nenhum update de tabela inteira nem em user_id ou created_at', () => {
    expect(sql).not.toMatch(/grant update on/);
    expect(sql).not.toMatch(/grant update \([^)]*(user_id|created_at)/);
  });

  it('nao concede delete nem privilegio a outros papeis', () => {
    expect(sql).not.toMatch(/grant[^;]*delete/);
    expect(sql).not.toMatch(/grant[^;]*to (anon|authenticated|public|[a-z]+_?role|app_api)/);
  });
});

describe('T-H035-MIG gatilho de protecao (decisao 54, item 2)', () => {
  it('campos do documento sao write-once quando ja estao gravados', () => {
    expect(trechoGatilho).toContain('if old.document_hmac is not null and (');
    for (const campo of ['public_name', 'slug', 'document_type', 'document_enc', 'document_hmac']) {
      expect(trechoGatilho).toContain(`new.${campo} is distinct from old.${campo}`);
    }
    expect(trechoGatilho).toContain("raise exception 'professional_documento_imutavel' using errcode = '42501';");
  });

  it('verification_status so muda no primeiro cadastro: pendente, HMAC novo, destino pendente ou retida', () => {
    expect(trechoGatilho).toContain('if new.verification_status is distinct from old.verification_status then');
    expect(trechoGatilho).toContain('old.document_hmac is null');
    expect(trechoGatilho).toContain("and old.verification_status = 'pendente'");
    expect(trechoGatilho).toContain("and new.verification_status in ('pendente', 'retida_duplicidade')");
    expect(trechoGatilho).toContain('and new.document_hmac is not null)');
    expect(trechoGatilho).toContain("raise exception 'professional_status_protegido' using errcode = '42501';");
  });

  it('o gatilho e BEFORE UPDATE, por linha, e fica ativo mesmo com session_replication_role', () => {
    expect(sql).toContain(
      'create trigger professional_profile_guard_update before update on app.professional_profile for each row execute function private.professional_profile_guard_update();',
    );
    expect(sql).toContain('alter table app.professional_profile enable always trigger professional_profile_guard_update;');
  });

  it('o gatilho nao menciona nenhum estado de revisao ou recusa como destino', () => {
    expect(trechoGatilho).not.toMatch(/verification_status = '(aprovada|em_revisao|recusada|suspensa)'/);
    expect(trechoGatilho).not.toMatch(/in \([^)]*(aprovada|em_revisao|recusada|suspensa)/);
  });
});

describe('T-H035-MIG funcao de gravacao (decisao 54, item 3; desenho §2 item 4)', () => {
  it('nao usa security definer em nenhuma funcao desta migracao', () => {
    expect(sql).not.toContain('security definer');
  });

  it('trava a linha do perfil antes de decidir', () => {
    expect(trechoFuncao).toContain('from app.professional_profile p where p.user_id = p_user_id for update;');
  });

  it('checa duplicidade contra outro perfil nao recusado com o mesmo HMAC', () => {
    expect(trechoFuncao).toContain('o.document_hmac = p_document_hmac');
    expect(trechoFuncao).toContain('and o.user_id <> p_user_id');
    expect(trechoFuncao).toContain("and o.verification_status <> 'recusada'");
    expect(trechoFuncao).toContain("case when v_duplicado then 'retida_duplicidade' else 'pendente' end");
  });

  it('devolve ja_cadastrado no reenvio e sem_perfil quando nao ha linha', () => {
    expect(trechoFuncao).toContain("return query select 'ja_cadastrado'::text;");
    expect(trechoFuncao).toContain("return query select 'sem_perfil'::text;");
  });

  it('trata 23505 (unique_violation): so o indice de HMAC vira retida; colisao de slug re-lanca', () => {
    expect(trechoFuncao).toContain('exception when unique_violation then');
    expect(trechoFuncao).toContain('get stacked diagnostics v_restricao = constraint_name;');
    expect(trechoFuncao).toContain("if v_restricao <> 'professional_profile_document_hmac_vivo_key' then");
    expect(trechoFuncao).toContain('raise;');
    expect(trechoFuncao).toContain("v_status := 'retida_duplicidade';");
  });

  it('a funcao so grava pendente ou retida: nunca aprovada, em revisao ou recusada', () => {
    expect(trechoFuncao).not.toMatch(/verification_status = '(aprovada|em_revisao|recusada|suspensa)'/);
    expect(trechoFuncao).not.toMatch(/set[^;]*verification_status = '(aprovada|em_revisao|recusada|suspensa)'/);
  });

  it('execucao so por app_system, com search_path vazio', () => {
    expect(sql).toContain(
      'grant execute on function private.professional_profile_set_document(uuid, text, text, text, bytea, text, timestamptz) to app_system;',
    );
    expect(sql).not.toMatch(/grant execute on function[^;]*to (anon|authenticated|public|[a-z]+_?role)/);
    expect(trechoFuncao).toContain("set search_path = ''");
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
    expect(sql).toContain('drop trigger if exists professional_profile_guard_update on app.professional_profile;');
  });
});

describe('T-H035-MIG rollback de 20261111420000', () => {
  it('em transacao, recusa rodar com documento cifrado gravado', () => {
    expect(rb.indexOf('begin;')).toBeLessThan(rb.indexOf('commit;'));
    expect(rb).toContain('where document_enc is not null');
    expect(rb).toContain('rollback_bloqueado_ha_documentos_cifrados');
  });

  it('remove gatilho, funcoes, grants por coluna, indices, CHECKs, colunas e o tipo de evento', () => {
    expect(rb).toContain('drop function if exists private.professional_profile_set_document(uuid, text, text, text, bytea, text, timestamptz);');
    expect(rb).toContain('drop trigger if exists professional_profile_guard_update on app.professional_profile;');
    expect(rb).toContain('drop function if exists private.professional_profile_guard_update();');
    expect(rb).toContain(
      'revoke update (public_name, slug, document_type, document_enc, document_hmac, verification_status, updated_at) on app.professional_profile from app_system;',
    );
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
