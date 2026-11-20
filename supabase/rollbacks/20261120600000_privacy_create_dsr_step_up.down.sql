-- Desfaz supabase/migrations/20261120600000_privacy_create_dsr_step_up.sql (Issue 120, H-111).
-- Recusa se houver codigo de step-up registrado: a prova de emissao e confirmacao e retida (sem exclusao).
-- A configuracao privacy.dsr_step_up_* e os tipos de auditoria ficam (aditivos e inofensivos).

do $$
begin
  if to_regclass('app.dsr_step_up_code') is not null
     and exists (select 1 from app.dsr_step_up_code) then
    raise exception 'dsr_step_up_com_registros';
  end if;
end
$$;

drop function if exists app.dsr_step_up_code_sealed(uuid);
drop function if exists app.dsr_step_up_confirm(uuid, text, text);
drop function if exists app.dsr_step_up_issue(uuid, uuid, text, bytea);

drop trigger if exists dsr_step_up_code_no_delete on app.dsr_step_up_code;
drop trigger if exists dsr_step_up_code_guard on app.dsr_step_up_code;
drop function if exists private.dsr_step_up_code_guard();

drop table if exists app.dsr_step_up_code;
