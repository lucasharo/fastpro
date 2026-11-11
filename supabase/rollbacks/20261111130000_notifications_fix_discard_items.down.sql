-- Desfaz 20261111130000_notifications_fix_discard_items.sql (H-092). EXECUCAO MANUAL e consciente:
-- so em banco de desenvolvimento. Devolve a definicao anterior de private.email_outbox_ajustar_itens
-- (que mantinha outbox_id nos itens descartados e viola a restricao de consistencia) e tira a
-- migracao do registro. Use somente se for preciso reverter a correcao.
begin;
create or replace function private.email_outbox_ajustar_itens(p_outbox_id uuid, p_descartes jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_classe text;
  v_restantes integer;
begin
  select o.class into v_classe from ops.email_outbox o where o.id = p_outbox_id for update;
  if not found then
    return 0;
  end if;

  update ops.notification_item i
     set state = 'descartado', discard_reason = d.motivo, decided_at = v_now
    from jsonb_to_recordset(coalesce(p_descartes, '[]'::jsonb)) as d(id uuid, motivo text)
   where i.id = d.id and i.outbox_id = p_outbox_id and i.state = 'enviado';

  select count(*)::integer into v_restantes from ops.notification_item i
   where i.outbox_id = p_outbox_id and i.state = 'enviado';

  if v_classe = 'digest' and v_restantes > 0 then
    update ops.email_outbox o
       set template_params = o.template_params || jsonb_build_object('count', v_restantes)
     where o.id = p_outbox_id;
  end if;
  return v_restantes;
end
$$;
delete from ops.schema_migration where version = '20261111130000';
commit;
