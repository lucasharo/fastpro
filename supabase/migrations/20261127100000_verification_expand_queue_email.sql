-- Fila da verificacao passa a trazer o e-mail do profissional (pedido do dono, 2026-11-27; muda o "fila sem e-mail"
-- do 124-DESENHO-H039). So quem tem verification.review e sessao valida recebe a linha, como antes. A coluna de saida
-- nova exige recriar a funcao; a regra, a ordenacao e os privilegios ficam iguais aos de 20261113280000.
drop function if exists private.verification_queue_list(uuid, text, text, integer, timestamptz, uuid, timestamptz);

create function private.verification_queue_list(
  p_actor uuid, p_session_hash text, p_scope text, p_limit integer,
  p_after_sla timestamptz, p_after_id uuid, p_now timestamptz)
returns table (out_id uuid, out_short_id text, out_status text, out_appeal_status text,
               out_sla_target_at timestamptz, out_received_at timestamptz, out_services text[],
               out_overdue boolean, out_assigned_to_me boolean, out_version integer,
               out_professional_email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or p_session_hash is null or p_scope is null or p_limit is null or p_now is null
     or (p_after_sla is null) <> (p_after_id is null) then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if p_scope not in ('pendentes', 'minhas', 'recursos', 'retidas') or p_limit < 1 or p_limit > 50 then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;

  return query
  select c.id, left(c.id::text, 8), c.status, c.appeal_status, c.sla_target_at,
         (select max(d.received_at) from app.identity_document d
           where d.professional_id = c.professional_id and d.status = 'recebido'
             and d.purge_requested_at is null),
         '{}'::text[],
         p_now > c.sla_target_at,
         coalesce(c.assigned_to = p_actor, false),
         c.version,
         u.email::text
    from app.verification_case c
    left join app.professional_profile p on p.user_id = c.professional_id
    left join app.app_user u on u.id = c.professional_id
   where (case p_scope
            when 'pendentes' then c.status = 'pendente'
                                  and coalesce(p.verification_status, '') <> 'retida_duplicidade'
            when 'minhas' then c.assigned_to = p_actor and c.status in ('em_revisao', 'retida_duplicidade')
            when 'recursos' then c.status = 'em_revisao' and c.assigned_to is null and c.appeal_status = 'pendente'
            when 'retidas' then c.status = 'retida_duplicidade'
                                or (c.status in ('pendente', 'em_revisao')
                                    and coalesce(p.verification_status, '') = 'retida_duplicidade')
          end)
     and (p_after_sla is null or (c.sla_target_at, c.id) > (p_after_sla, p_after_id))
   order by c.sla_target_at, c.id
   limit p_limit;
end
$$;

revoke all on function private.verification_queue_list(uuid, text, text, integer, timestamptz, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.verification_queue_list(uuid, text, text, integer, timestamptz, uuid, timestamptz) to app_system;
