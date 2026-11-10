-- Desfaz 20261110150000_audit_fix_forbidden_keys.sql: restaura a versao anterior de
-- private.audit_key_is_forbidden (definida em 20261110140000). EXECUCAO MANUAL e consciente: so em
-- banco de desenvolvimento. Nao apaga dados. Remova antes migracoes posteriores que dependam da regra.
begin;
delete from ops.schema_migration where version = '20261110150000';
create or replace function private.audit_key_is_forbidden(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key is null
      or regexp_replace(lower(p_key), '[_.-]', '', 'g') ~
         '(email|mail|telefone|phone|celular|whatsapp|cpf|cnpj|documento|endereco|address|logradouro|latitude|longitude|useragent|mensagem|message|senha|password|token|secret|birth|nascimento)'
      or (regexp_split_to_array(lower(p_key), '[_.-]+'))[1] = any (array[
           'rg','nome','name','cep','lat','lng','ip','texto','text','body','conteudo','content'])
      or (regexp_split_to_array(lower(p_key), '[_.-]+'))[
           cardinality(regexp_split_to_array(lower(p_key), '[_.-]+'))] = any (array[
           'rg','nome','name','cep','lat','lng','ip','texto','text','body','conteudo','content'])
$$;
commit;
