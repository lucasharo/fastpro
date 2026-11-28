-- O "Documento" do caso e o de identidade. Com o envio de certificacoes pelo app (2026-11-27), o detalhe passava a
-- mostrar o arquivo mais novo, que podia ser uma certificacao. Certificacao so aparece se nao houver identidade.
-- Mesma assinatura, regra de acesso e privilegios de antes.
create or replace function private.verification_case_detail(p_actor uuid, p_session_hash text, p_case uuid, p_now timestamp with time zone)
returns table (out_id uuid, out_short_id text, out_status text, out_appeal_status text,
               out_sla_target_at timestamp with time zone, out_received_at timestamp with time zone, out_services text[],
               out_overdue boolean, out_assigned_to_me boolean, out_version integer, out_reason_code text,
               out_explanation text, out_decided_at timestamp with time zone, out_document_available boolean,
               out_document_id uuid, out_document_received_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_doc record;
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

  select d.id, d.received_at into v_doc from app.identity_document d
   where d.professional_id = v_case.professional_id and d.status = 'recebido'
     and d.purge_requested_at is null
   order by (d.kind = 'identidade') desc, d.received_at desc limit 1;

  return query select v_case.id, left(v_case.id::text, 8), v_case.status, v_case.appeal_status,
         v_case.sla_target_at, v_doc.received_at, '{}'::text[], p_now > v_case.sla_target_at,
         coalesce(v_case.assigned_to = p_actor, false), v_case.version,
         v_case.reason_code, v_case.explanation_to_professional, v_case.decided_at,
         v_doc.id is not null, v_doc.id, v_doc.received_at;
end
$$;
