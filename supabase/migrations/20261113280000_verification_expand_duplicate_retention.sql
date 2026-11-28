-- Issue 53 (H-040) | Retencao por duplicidade: expansao ADITIVA sobre a Verificacao da Issue 52.
-- Desenho: docs/factory/134-DESENHO-H040.md (§3). Desfazer: supabase/rollbacks/20261113280000_verification_expand_duplicate_retention.down.sql.
-- Assinaturas inalteradas. Nenhuma tabela, coluna ou constraint nova. O indice unico do H-035 ja existe (nao recriado).
-- Regra: perfil retido nunca vai a em_revisao por espelho; so decisao da Verificacao o muda; aprovacao com
-- original vivo falha com VRF08 (a constraint do indice e a barreira de integridade na corrida).
-- Sem cron, ops.job, gatilho de tempo ou chamada externa. Relogio entra por parametro (p_now).
-- Idempotente (create or replace, drop trigger if exists, on conflict do nothing).

-- 1. Funcoes de apoio -------------------------------------------------------------------------------
-- Original vivo: outro perfil com o mesmo HMAC fora de recusada e retida_duplicidade (mesma condicao do indice).
create or replace function private.verification_duplicate_original_alive(p_professional uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from app.professional_profile me
      join app.professional_profile o
        on o.document_hmac = me.document_hmac and o.user_id <> me.user_id
     where me.user_id = p_professional
       and me.document_hmac is not null
       and o.verification_status not in ('recusada', 'retida_duplicidade'))
$$;

-- Espelho bloqueado: perfil retido, ou recusado cujo espelho em em_revisao colidiria com original vivo.
create or replace function private.verification_profile_mirror_blocked(p_professional uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from app.professional_profile p
     where p.user_id = p_professional
       and (p.verification_status = 'retida_duplicidade'
            or (p.verification_status = 'recusada'
                and private.verification_duplicate_original_alive(p.user_id))))
$$;

-- Visao da duplicidade para a Verificacao (CA-H040-16). So vocabulario fixo; sem nome, e-mail, documento,
-- HMAC, tipo ou datas do outro perfil. Autoriza como verification_case_detail.
create or replace function private.verification_duplicate_view(
  p_actor uuid, p_session_hash text, p_case uuid, p_now timestamptz)
returns table (out_is_duplicate boolean, out_original_short_id text, out_original_status text,
               out_original_alive boolean, out_can_approve boolean, out_document_hmac_present boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_profile app.professional_profile%rowtype;
  v_orig record;
  v_alive boolean;
  v_dup boolean;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case;
  if not found or v_case.professional_id = p_actor
     or (v_case.assigned_to is not null and v_case.assigned_to <> p_actor) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;

  select * into v_profile from app.professional_profile p where p.user_id = v_case.professional_id;
  if not found or v_profile.document_hmac is null then
    return query select false, null::text, 'nenhum'::text, false, true, false;
    return;
  end if;

  -- Prioridade: original vivo; senao o recusado mais recente. Retido nao conta como original.
  select o.user_id, o.verification_status,
         (o.verification_status not in ('recusada', 'retida_duplicidade')) as alive
    into v_orig
    from app.professional_profile o
   where o.document_hmac = v_profile.document_hmac and o.user_id <> v_profile.user_id
     and o.verification_status <> 'retida_duplicidade'
   order by (o.verification_status not in ('recusada', 'retida_duplicidade')) desc, o.updated_at desc nulls last
   limit 1;

  v_dup := v_profile.verification_status = 'retida_duplicidade'
           or exists (select 1 from app.professional_profile o
                       where o.document_hmac = v_profile.document_hmac and o.user_id <> v_profile.user_id);
  v_alive := coalesce(v_orig.alive, false);

  return query select v_dup,
         case when v_orig.user_id is null then null else left(v_orig.user_id::text, 8) end,
         case when v_orig.user_id is null then 'nenhum' when v_alive then 'vivo' else 'recusado' end,
         v_alive,
         not v_alive,
         true;
end
$$;

-- 2. Auditoria do cadastro retido (CA-H040-12; evento novo sem dado pessoal) ----------------------
-- Cobre so o cadastro (primeira gravacao do documento). A retencao manual ja grava verification.case.decided.
create or replace function private.professional_profile_retained_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.audit_append('system:verification', 'system', 'verification.profile.retained',
    'professional_profile', new.user_id, '{}'::jsonb, '{"verification_status":"retida_duplicidade"}'::jsonb,
    'duplicidade_suspeita', null);
  return new;
end;
$$;

drop trigger if exists professional_profile_retained_audit on app.professional_profile;
create trigger professional_profile_retained_audit
  after update of verification_status on app.professional_profile
  for each row
  when (old.document_hmac is null
        and new.verification_status = 'retida_duplicidade'
        and old.verification_status is distinct from 'retida_duplicidade')
  execute function private.professional_profile_retained_audit();

insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('verification.profile.retained', 'professional_profile', true, array['verification_status'],
   'Cadastro retido por duplicidade de documento (Issue 53, H-040, sem identificador do original)')
on conflict (action, object_type) do nothing;

-- 3. Mudancas aditivas nas funcoes da Issue 52 (assinatura e colunas inalteradas) ------------------

-- 3.1 Atribuicao: o espelho em em_revisao so vai ao perfil quando nao esta bloqueado (RN-H040-06, dec. 525).
create or replace function private.verification_case_assign(
  p_actor uuid, p_session_hash text, p_case uuid, p_expected_version integer, p_now timestamptz)
returns table (out_status text, out_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_version integer;
  v_audit uuid;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_expected_version is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case for update;
  if not found or v_case.professional_id = p_actor then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_case.version <> p_expected_version then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;
  if v_case.status = 'pendente' then
    null;
  elsif v_case.status = 'em_revisao' and v_case.assigned_to is null and v_case.appeal_status = 'pendente' then
    if v_case.decided_by = p_actor then
      raise exception 'permissao_negada' using errcode = '42501';
    end if;
  else
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;

  update app.verification_case c
     set status = 'em_revisao', assigned_to = p_actor, assigned_at = p_now, updated_at = p_now
   where c.id = p_case;
  if not private.verification_profile_mirror_blocked(v_case.professional_id) then
    update app.professional_profile p
       set verification_status = 'em_revisao', updated_at = p_now
     where p.user_id = v_case.professional_id;
  end if;

  v_audit := private.audit_append('admin:' || p_actor::text, 'verificacao', 'verification.case.assigned',
    'verification_case', p_case, jsonb_build_object('status', v_case.status, 'assigned', false),
    '{"status":"em_revisao","assigned":true}'::jsonb, null, null);
  perform private.verification_event_add(p_case, 'assigned', p_actor, 'verificacao', v_case.status,
    'em_revisao', null, null, v_audit, p_now);

  select c.version into v_version from app.verification_case c where c.id = p_case;
  return query select 'em_revisao'::text, v_version;
end
$$;

-- 3.2 Decisao: aprovacao com original vivo falha com VRF08 (RN-H040-05, dec. 477). Recusa com
-- duplicidade_suspeita so quando o perfil esta retido (dec. 526). Demais regras inalteradas.
create or replace function private.verification_case_decide(
  p_actor uuid, p_session_hash text, p_case uuid, p_decision text, p_reason_code text,
  p_complement text, p_expected_version integer, p_now timestamptz)
returns table (out_status text, out_version integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_profile app.professional_profile%rowtype;
  v_complement text := nullif(btrim(coalesce(p_complement, '')), '');
  v_retained boolean;
  v_version integer;
  v_audit uuid;
  v_appeal_after text;
begin
  if p_actor is null or p_session_hash is null or p_case is null or p_expected_version is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  if not private.admin_has_permission(p_actor, 'verification.review')
     or not private.verification_session_ok(p_actor, p_session_hash, p_now) then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  select * into v_case from app.verification_case c where c.id = p_case for update;
  if not found or v_case.assigned_to is distinct from p_actor
     or v_case.status not in ('em_revisao', 'retida_duplicidade') then
    raise exception 'permissao_negada' using errcode = '42501';
  end if;
  if v_case.version <> p_expected_version then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;

  v_retained := coalesce((select p.verification_status = 'retida_duplicidade'
                            from app.professional_profile p where p.user_id = v_case.professional_id), false);

  if p_decision is null or p_decision not in ('aprovada', 'recusada', 'retida_duplicidade')
     or p_reason_code is null
     or p_reason_code not in ('aprovado', 'documento_ilegivel', 'documento_divergente', 'tipo_nao_aceito',
                              'duplicidade_suspeita', 'certificacao_insuficiente', 'outro')
     or (p_decision = 'aprovada' and p_reason_code <> 'aprovado')
     or (p_decision = 'retida_duplicidade' and p_reason_code <> 'duplicidade_suspeita')
     or (p_decision = 'recusada' and (p_reason_code = 'aprovado'
                                      or (p_reason_code = 'duplicidade_suspeita' and not v_retained))) then
    raise exception 'motivo_invalido' using errcode = 'VRF02';
  end if;

  if (p_complement is not null and char_length(p_complement) > 500)
     or (p_reason_code = 'outro' and v_complement is null)
     or (v_complement is not null and private.verification_text_has_pii(v_complement)) then
    raise exception 'explicacao_invalida' using errcode = 'VRF03';
  end if;

  if p_decision = 'retida_duplicidade' and v_case.status <> 'em_revisao' then
    raise exception 'caso_conflito' using errcode = 'VRF01';
  end if;

  select * into v_profile from app.professional_profile p where p.user_id = v_case.professional_id for update;
  if p_decision = 'aprovada' then
    if not exists (select 1 from app.identity_document d
                    where d.professional_id = v_case.professional_id and d.status = 'recebido'
                      and d.purge_requested_at is null and d.analyzed_at is not null) then
      raise exception 'identidade_nao_analisada' using errcode = 'VRF04';
    end if;
    if v_profile.verification_status = 'suspensa' then
      raise exception 'perfil_suspenso' using errcode = 'VRF07';
    end if;
    if private.verification_reg_gate(v_case.professional_id) = 'incompletas' then
      raise exception 'certificacao_pendente' using errcode = 'VRF05';
    end if;
    if private.verification_duplicate_original_alive(v_case.professional_id) then
      raise exception 'original_vivo' using errcode = 'VRF08';
    end if;
  end if;

  v_appeal_after := case when v_case.appeal_status = 'pendente' then 'decidido' else v_case.appeal_status end;
  update app.verification_case c
     set status = p_decision, reason_code = p_reason_code, explanation_to_professional = v_complement,
         decided_by = p_actor, decided_at = p_now, appeal_status = v_appeal_after, updated_at = p_now
   where c.id = p_case;
  update app.professional_profile p
     set verification_status = p_decision,
         verified_at = case when p_decision = 'aprovada' then p_now else p.verified_at end,
         updated_at = p_now
   where p.user_id = v_case.professional_id;

  v_audit := private.audit_append('admin:' || p_actor::text, 'verificacao', 'verification.case.decided',
    'verification_case', p_case,
    jsonb_build_object('status', v_case.status, 'appeal_status', v_case.appeal_status),
    jsonb_build_object('status', p_decision, 'appeal_status', v_appeal_after), p_reason_code, null);
  perform private.verification_event_add(p_case, 'decided', p_actor, 'verificacao', v_case.status, p_decision,
    p_reason_code, v_complement, v_audit, p_now);

  select c.version into v_version from app.verification_case c where c.id = p_case;
  return query select p_decision, v_version;
end
$$;

-- 3.3 Recurso: perfil retido, ou recusado com original vivo, nao recebe espelho; o caso vai a em_revisao
-- sem dono e a resposta continua ok (dec. 527, CA-H040-11).
create or replace function private.verification_case_appeal(p_professional uuid, p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_audit uuid;
begin
  if p_professional is null or p_now is null then
    raise exception 'admin_entrada_invalida' using errcode = '22023';
  end if;
  select * into v_case from app.verification_case c where c.professional_id = p_professional for update;
  if not found then
    return query select 'sem_caso'::text;
    return;
  end if;
  if v_case.appeal_status <> 'nenhum' then
    return query select 'recurso_ja_usado'::text;
    return;
  end if;
  if v_case.status not in ('recusada', 'retida_duplicidade') then
    return query select 'nao_elegivel'::text;
    return;
  end if;

  update app.verification_case c
     set status = 'em_revisao', appeal_status = 'pendente', assigned_to = null, assigned_at = null,
         updated_at = p_now
   where c.id = v_case.id;
  if not private.verification_profile_mirror_blocked(p_professional) then
    update app.professional_profile p
       set verification_status = 'em_revisao', updated_at = p_now
     where p.user_id = p_professional;
  end if;

  v_audit := private.audit_append('professional:' || p_professional::text, 'profissional',
    'verification.case.appeal_received', 'verification_case', v_case.id,
    jsonb_build_object('status', v_case.status, 'appeal_status', 'nenhum'),
    '{"status":"em_revisao","appeal_status":"pendente"}'::jsonb, null, null);
  perform private.verification_event_add(v_case.id, 'appeal_received', null, 'profissional', v_case.status,
    'em_revisao', null, null, v_audit, p_now);
  return query select 'ok'::text;
end
$$;

-- 3.4 Fila: retidas inclui caso de perfil retido ainda sem decisao; pendentes o exclui.
-- Colunas de saida e ordenacao inalteradas.
create or replace function private.verification_queue_list(
  p_actor uuid, p_session_hash text, p_scope text, p_limit integer,
  p_after_sla timestamptz, p_after_id uuid, p_now timestamptz)
returns table (out_id uuid, out_short_id text, out_status text, out_appeal_status text,
               out_sla_target_at timestamptz, out_received_at timestamptz, out_services text[],
               out_overdue boolean, out_assigned_to_me boolean, out_version integer)
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
         c.version
    from app.verification_case c
    left join app.professional_profile p on p.user_id = c.professional_id
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

-- 4. Privilegios: funcoes novas sem execucao para papeis de API; so app_system na de leitura da Verificacao.
revoke all on function private.verification_duplicate_original_alive(uuid)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.verification_profile_mirror_blocked(uuid)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.verification_duplicate_view(uuid, text, uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_profile_retained_audit()
  from public, anon, authenticated, service_role, app_api;

grant execute on function private.verification_duplicate_view(uuid, text, uuid, timestamptz) to app_system;
grant execute on function private.verification_case_assign(uuid, text, uuid, integer, timestamptz) to app_system;
grant execute on function private.verification_case_decide(uuid, text, uuid, text, text, text, integer, timestamptz) to app_system;
grant execute on function private.verification_case_appeal(uuid, timestamptz) to app_system;
grant execute on function private.verification_queue_list(uuid, text, text, integer, timestamptz, uuid, timestamptz) to app_system;
