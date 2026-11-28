-- Desfaz 20261112220000_identity_create_documents.sql (H-037, Issue #50). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Ordem: guarda de dados, gatilho, funcoes, tabela, buckets e linhas de catalogo.
-- Guarda: se app.identity_document tiver linha, ou se houver objeto em identity-incoming ou identity-docs,
-- aborta com rollback_recusado_com_dados, a menos que set app.rollback_force = '1' (convencao do H-036; so dev).
-- Mesmo com a forca, as linhas de catalogo de auditoria so saem se nao houver evento referenciando (FK restrict).
-- Idempotente (if exists / on conflict). Nao toca professional_profile, app_user nem buckets de fotos.
begin;

-- 0. Guarda de dados.
do $$
declare
  v_linhas bigint := 0;
  v_objetos bigint := 0;
begin
  if to_regclass('app.identity_document') is not null then
    execute 'select count(*) from app.identity_document' into v_linhas;
  end if;
  if to_regclass('storage.objects') is not null then
    select count(*) into v_objetos from storage.objects
     where bucket_id in ('identity-incoming', 'identity-docs');
  end if;
  if (v_linhas > 0 or v_objetos > 0)
     and coalesce(current_setting('app.rollback_force', true), '') <> '1' then
    raise exception 'rollback_recusado_com_dados'
      using detail = format('%s linha(s) em app.identity_document e %s objeto(s) nos buckets de identidade; use set app.rollback_force = ''1'' somente em dev',
                            v_linhas, v_objetos);
  end if;
end;
$$;

-- 1. Gatilho de limite.
drop trigger if exists identity_document_limite on app.identity_document;

-- 2. Funcoes.
drop function if exists private.idoc_known_pending(uuid[]);
drop function if exists private.idoc_purge_done(uuid[]);
drop function if exists private.idoc_sweep(timestamptz, integer);
drop function if exists private.idoc_delete(uuid, uuid, timestamptz);
drop function if exists private.idoc_confirm_release(uuid, smallint, boolean);
drop function if exists private.idoc_confirm_refuse(uuid, uuid, smallint, text, timestamptz);
drop function if exists private.idoc_confirm_done(uuid, uuid, smallint, text, integer, bytea, timestamptz);
drop function if exists private.idoc_confirm_begin(uuid, uuid, timestamptz, integer);
drop function if exists private.idoc_list(uuid, timestamptz);
drop function if exists private.idoc_issue(uuid, uuid, text, integer, timestamptz, bigint);
drop function if exists private.idoc_limite();

-- 3. Tabela (a guarda garantiu que esta vazia, ou o operador forcou em dev).
drop table if exists app.identity_document;

-- 4. Buckets (a guarda garantiu que nao ha objetos, ou o operador forcou em dev).
--    O Supabase bloqueia DELETE direto em tabelas do storage; a liberacao e local a esta transacao (set_config
--    com is_local = true) e so vale para este comando.
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.buckets where id in ('identity-incoming', 'identity-docs');
select set_config('storage.allow_delete_query', 'false', true);

-- 5. Linhas de catalogo de auditoria (falham por FK se ja houver evento; e o desejado).
delete from audit.action_catalog
 where object_type = 'identity_document'
   and action in ('identity.doc.received', 'identity.doc.refused', 'identity.doc.deleted');

commit;
