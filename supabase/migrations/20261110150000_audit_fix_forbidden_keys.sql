-- H-006 | Correcao F-1 (Reviewer): regra de chaves com dado pessoal mais forte em
-- private.audit_key_is_forbidden. Substitui a versao da migracao 20261110140000 (que NAO e editada).
-- Idempotente (create or replace; mesma assinatura, usada pelas CHECKs de state_keys e de before/after).
-- Desfazer: supabase/rollbacks/20261110150000_audit_fix_forbidden_keys.down.sql (manual, so em dev).
-- Fontes: docs/factory/23-DESENHO-H006.md §1.4 item 3 (CA-09); espelho packages/db/src/audit.ts
-- (isForbiddenStateKey). Nenhum segredo e versionado.
--
-- Regra sobre a chave normalizada (camelCase vira palavras; minusculas; _ . - separam palavras):
--   a) termos longos casam como substring da chave sem separadores (email, telefone, cpf, addr,
--      fullname, username, firstname, lastname, nome...);
--   b) termos curtos casam como PALAVRA em qualquer posicao (name, ip, rg, lat, lng, cep, body,
--      conteudo, content): customer_name_hash e client_ip_hash sao barradas;
--   c) text/texto casam como palavra em qualquer posicao, EXCETO quando a ultima palavra e
--      version/versao (consent_text_version continua valida; user_text_snapshot e barrada).

create or replace function private.audit_key_is_forbidden(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with v as (
    select lower(regexp_replace(p_key, '([a-z0-9])([A-Z])', '\1_\2', 'g')) as s
  ), w as (
    select v.s, regexp_split_to_array(v.s, '[_.-]+') as ws from v
  )
  select p_key is null
      or exists (
        select 1 from w
         where regexp_replace(w.s, '[_.-]', '', 'g') ~
               '(email|mail|telefone|phone|celular|whatsapp|cpf|cnpj|documento|endereco|addr|logradouro|latitude|longitude|useragent|mensagem|message|senha|password|token|secret|birth|nascimento|fullname|username|firstname|lastname|nome)'
            or exists (
                 select 1 from unnest(w.ws) as x
                  where x = any (array['rg','name','cep','lat','lng','ip','body','conteudo','content']))
            or (exists (
                 select 1 from unnest(w.ws) as x
                  where x = any (array['text','texto']))
                and w.ws[cardinality(w.ws)] <> all (array['version','versao']))
      )
$$;
