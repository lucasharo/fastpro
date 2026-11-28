-- Issue 54 (H-041) | Estado da verificacao visivel ao profissional (docs/factory/141-DESENHO-H041.md §3 e §4).
-- Duas funcoes private, sem tabela, coluna, gatilho, cron, job ou catalogo de auditoria novos:
--   private.professional_verification_state(p_professional): leitura somente (STABLE). Nao escreve, nao audita,
--     nao le document_hmac nem outro perfil. Traduz o estado interno para o vocabulario publico (dec. 543, 546, 624a).
--   private.professional_verification_appeal(p_professional, p_now): envelope de private.verification_case_appeal
--     (Issue 52, intocada) com a restricao de H-041 (so recusada, sem recurso anterior, perfil nao suspenso; dec. 549).
-- Execute so para app_system. Nenhuma funcao, tabela ou gatilho existente muda.

-- 1. Leitura do estado visivel --------------------------------------------------------------------------
create or replace function private.professional_verification_state(p_professional uuid)
returns table (out_state text, out_reason_code text, out_explanation text, out_decided_at timestamptz, out_appeal text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile_status text;
  v_verified_at timestamptz;
  v_case app.verification_case%rowtype;
  v_tem_documento boolean;
begin
  if p_professional is null then
    raise exception 'entrada_invalida' using errcode = '22023';
  end if;

  select p.verification_status, p.verified_at
    into v_profile_status, v_verified_at
    from app.professional_profile p
   where p.user_id = p_professional;
  if not found then
    return;
  end if;

  -- Precedencia 1: perfil suspenso.
  if v_profile_status = 'suspensa' then
    return query select 'suspensa'::text, null::text, null::text, null::timestamptz, 'indisponivel'::text;
    return;
  end if;

  -- Precedencia 2: caso de verificacao (fonte do estado quando existe).
  select * into v_case from app.verification_case c where c.professional_id = p_professional;
  if found then
    if v_case.status = 'suspensa' then
      return query select 'suspensa'::text, null::text, null::text, null::timestamptz, 'indisponivel'::text;
      return;
    end if;
    if v_case.status in ('pendente', 'em_revisao', 'retida_duplicidade') then
      return query select 'em_analise'::text, null::text, null::text, null::timestamptz,
        (case when v_case.appeal_status = 'pendente' then 'recebido' else 'indisponivel' end)::text;
      return;
    end if;
    if v_case.status = 'aprovada' then
      return query select 'aprovada'::text, null::text, null::text,
        coalesce(v_case.decided_at, v_verified_at), 'indisponivel'::text;
      return;
    end if;
    -- recusada: motivo e explicacao nunca saem para duplicidade_suspeita nem para aprovado (dec. 544, 545, 624a).
    return query select 'recusada'::text,
      (case when v_case.reason_code in ('duplicidade_suspeita', 'aprovado') then null else v_case.reason_code end)::text,
      (case when v_case.reason_code in ('duplicidade_suspeita', 'aprovado') then null
            else v_case.explanation_to_professional end)::text,
      v_case.decided_at,
      (case v_case.appeal_status
         when 'nenhum' then 'disponivel'
         when 'pendente' then 'recebido'
         else 'analisado' end)::text;
    return;
  end if;

  -- Precedencia 3: sem caso e sem documento de identidade recebido.
  select exists (
    select 1
      from app.identity_document d
     where d.professional_id = p_professional
       and d.status = 'recebido'
       and d.purge_requested_at is null)
    into v_tem_documento;
  if not v_tem_documento then
    return query select 'sem_envio'::text, null::text, null::text, null::timestamptz, 'indisponivel'::text;
    return;
  end if;

  -- Precedencia 4: documento recebido sem caso (legado ou corrida): mapeia o status do perfil.
  if v_profile_status in ('pendente', 'em_revisao', 'retida_duplicidade') then
    return query select 'em_analise'::text, null::text, null::text, null::timestamptz, 'indisponivel'::text;
  elsif v_profile_status = 'aprovada' then
    return query select 'aprovada'::text, null::text, null::text, v_verified_at, 'indisponivel'::text;
  else
    return query select 'recusada'::text, null::text, null::text, null::timestamptz, 'indisponivel'::text;
  end if;
end
$$;

-- 2. Recurso do profissional (envelope) -------------------------------------------------------------------
create or replace function private.professional_verification_appeal(p_professional uuid, p_now timestamptz)
returns table (out_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case app.verification_case%rowtype;
  v_profile_status text;
begin
  if p_professional is null or p_now is null then
    raise exception 'entrada_invalida' using errcode = '22023';
  end if;

  -- Mesmo lock de private.verification_case_appeal (reentrante na mesma transacao).
  select * into v_case from app.verification_case c where c.professional_id = p_professional for update;
  if not found then
    return query select 'sem_caso'::text;
    return;
  end if;

  select p.verification_status into v_profile_status
    from app.professional_profile p
   where p.user_id = p_professional;

  -- Dec. 549: recurso so em recusada; perfil suspenso nunca recorre (dec. 380).
  if v_case.status <> 'recusada' or v_profile_status = 'suspensa' then
    return query select 'nao_elegivel'::text;
    return;
  end if;
  if v_case.appeal_status <> 'nenhum' then
    return query select 'recurso_ja_usado'::text;
    return;
  end if;

  return query select r.out_code from private.verification_case_appeal(p_professional, p_now) r;
end
$$;

-- 3. Privilegios: so app_system executa; nenhum papel de API ou publico ---------------------------------
revoke all on function private.professional_verification_state(uuid)
  from public, anon, authenticated, service_role, app_api;
revoke all on function private.professional_verification_appeal(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.professional_verification_state(uuid) to app_system;
grant execute on function private.professional_verification_appeal(uuid, timestamptz) to app_system;
