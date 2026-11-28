-- Desfaz 20261112160000_profile_expand_services_area.sql (H-036). EXECUCAO MANUAL e consciente: so em banco de
-- desenvolvimento. Remove as tres tabelas, os gatilhos, as funcoes e a chave de parametros semeada (se nao alterada).
-- Guarda: se alguma das tabelas tiver linha, aborta com rollback_recusado_com_dados, salvo se a sessao definir
-- app.rollback_force = '1' (perda de dado do usuario so de proposito). Nao toca geocode_point, geo_*, perfil,
-- catalogo, auditoria nem ops.* (exceto a chave semeada). Idempotente (if exists).
begin;

do $$
begin
  if coalesce(current_setting('app.rollback_force', true), '') <> '1'
     and (exists (select 1 from app.professional_service)
          or exists (select 1 from app.professional_area)
          or exists (select 1 from app.professional_area_history)) then
    raise exception 'rollback_recusado_com_dados' using errcode = '23514';
  end if;
end
$$;

drop table if exists app.professional_area_history;
drop table if exists app.professional_area;
drop table if exists app.professional_service;

drop function if exists private.professional_offering_purge(uuid);
drop function if exists private.professional_area_at(uuid, timestamptz);
drop function if exists private.professional_area_get(uuid, timestamptz);
drop function if exists private.professional_services_list(uuid);
drop function if exists private.professional_services_save(uuid, jsonb, timestamptz, text);
drop function if exists private.professional_area_save(uuid, uuid, text, integer, timestamptz);
drop function if exists private.professional_area_precheck(uuid, text, text, boolean, timestamptz);
drop function if exists private.professional_area_history_guard();
drop function if exists private.professional_area_apagar();
drop function if exists private.professional_area_ponto();
drop function if exists private.professional_service_regras();
drop function if exists private.professional_offering_limits();
drop function if exists private.offering_cfg_int(jsonb, text, integer, integer, integer);

delete from ops.app_config where key = 'profile.offering_limits' and version = 1;

commit;
