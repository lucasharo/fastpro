-- Desfaz 20261112200000_identity_create_role_exclusivity.sql (H-017, Issue #30). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Ordem: guarda de dados, gatilhos, funcoes, tabela app.customer_profile,
-- linha de catalogo de auditoria (so se nao referenciada) e a linha do ledger.
-- Guarda: se app.customer_profile tiver linha, aborta com rollback_recusado_com_dados, a menos que
-- set app.rollback_force = '1' (mesma convencao do desenho H-036; so dev). Nao toca app_user, professional_profile
-- nem admin_staff alem de remover os gatilhos. Idempotente (if exists / to_regclass).
begin;

-- 0. Guarda de dados.
do $$
declare
  v_linhas bigint := 0;
begin
  if to_regclass('app.customer_profile') is not null then
    execute 'select count(*) from app.customer_profile' into v_linhas;
    if v_linhas > 0 and coalesce(current_setting('app.rollback_force', true), '') <> '1' then
      raise exception 'rollback_recusado_com_dados'
        using detail = format('%s linha(s) em app.customer_profile; use set app.rollback_force = ''1'' somente em dev', v_linhas);
    end if;
  end if;
end;
$$;

-- 1. Gatilhos (o de aceite so existe se a tabela de aceite ja tiver sido criada por outra historia).
drop trigger if exists app_user_identidade_imutavel on app.app_user;
drop trigger if exists role_excl_chave_admin on app.admin_staff;
drop trigger if exists role_excl_admin on app.admin_staff;
drop trigger if exists role_excl_chave_profissional on app.professional_profile;
drop trigger if exists role_excl_profissional on app.professional_profile;

do $$
begin
  if to_regclass('app.acceptance') is not null then
    drop trigger if exists acceptance_nao_proprio_pedido on app.acceptance;
  end if;
end;
$$;

-- 2. Funcoes.
drop function if exists private.acceptance_not_own_request();
drop function if exists private.customer_profile_ensure(uuid, timestamptz);
drop function if exists private.app_user_identidade_imutavel();
drop function if exists private.role_excl_chave_imutavel();
drop function if exists private.role_excl_guard_admin();
drop function if exists private.role_excl_guard_professional();
drop function if exists private.role_excl_guard_customer();
drop function if exists private.role_excl_lock(uuid);

-- 3. Tabela de perfil de cliente (a guarda garantiu que esta vazia, ou o operador forcou em dev).
drop table if exists app.customer_profile;

-- 4. Acao de auditoria: removida so se nenhum evento a referencia (a cadeia de auditoria e imutavel).
do $$
begin
  if not exists (select 1 from audit.audit_event e where e.action = 'identity.role_exclusivity.denied') then
    delete from audit.action_catalog
     where action = 'identity.role_exclusivity.denied' and object_type = 'app_user';
  end if;
end;
$$;

delete from ops.schema_migration where version = '20261112200000';

commit;
