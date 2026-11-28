-- Certificacoes no detalhe do caso (2026-11-27): um item por servico regulamentado do profissional, com a
-- certificacao recebida quando houver. Mesma regra de acesso de private.verification_case_detail. A abertura do
-- arquivo segue por private.idoc_review_target (so quem assumiu o caso; cada leitura registrada).
create or replace function private.verification_case_certificates(
  p_actor uuid, p_session_hash text, p_case uuid, p_now timestamp with time zone)
returns table (out_service_id uuid, out_service_name text, out_document_id uuid,
               out_received_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case;
  if not found or (v_case.assigned_to is not null and v_case.assigned_to <> p_actor) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  return query
  select s.id, s.name::text, d.id, d.received_at
    from (select distinct ps.service_id from app.professional_service ps
           where ps.professional_id = v_case.professional_id) v
    join app.service s on s.id = v.service_id and s.regulated
    left join app.identity_document d
      on d.professional_id = v_case.professional_id and d.service_id = s.id and d.kind = 'certificacao'
     and d.status = 'recebido' and d.purge_requested_at is null
   order by s.name, s.id;
end
$$;

revoke all on function private.verification_case_certificates(uuid, text, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.verification_case_certificates(uuid, text, uuid, timestamptz) to app_system;
