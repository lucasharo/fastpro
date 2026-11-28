
-- H-044 (Issue 57) | Ativacao do trial de 14 dias (docs/factory/135-DESENHO-H044.md, §3 a §4).
-- Expansao pura: duas funcoes privadas e duas linhas do catalogo de auditoria. Nenhuma tabela existente e
-- alterada; nenhum grant de tabela; nenhum cron, ops.job, gatilho de tempo ou chamada a gateway (CA-H044-16).
-- A derivacao private.identity_id_from_document_hmac e imutavel e deterministica (dec. 289 e 496): o
-- identity_id nunca e gravado em coluna de professional_profile e nunca sai da camada de banco.
-- A funcao private.trial_activate e a unica escrita de billing.access_grant do tipo trial. Ela e
-- security definer, executavel so por app_system, e grava pelo dono (como private.access_grant_revoke, H-045).
-- Relogio injetado: p_now vem do chamador (relogio do servidor da API); o corpo nao le now() nem clock_timestamp().
-- Negacao de negocio (not_verified, trial_used, paid_access_active) devolve codigo e nao levanta excecao,
-- para que a auditoria de trial_used seja gravada. Falha tecnica (auditoria, banco) levanta e desfaz tudo.
-- Idempotente (create or replace, on conflict do nothing).
-- Desfazer: supabase/rollbacks/20261113270000_billing_create_trial_activation.down.sql.

-- 1. Identidade derivada do documento (dec. 289 e 496). Funcao pura: mesma entrada, mesmo uuid.
-- sha256 de 'fastpro:identity:v1:' || document_hmac, truncado aos primeiros 128 bits. Nao ajusta bits de versao
-- do uuid (qualquer 128 bits e um uuid valido). Prefixo versionado: uma v2 futura nao colide com a v1.
-- Entrada fora de 64 hexadecimais minusculos recusa com 22023 (falha tecnica, nunca regra de negocio).
create or replace function private.identity_id_from_document_hmac(p_hmac text)
returns uuid
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
begin
  if p_hmac !~ '^[0-9a-f]{64}$' then
    raise exception 'identidade_invalida' using errcode = '22023';
  end if;
  return encode(substring(sha256(convert_to('fastpro:identity:v1:' || p_hmac, 'UTF8')) from 1 for 16), 'hex')::uuid;
end
$$;

comment on function private.identity_id_from_document_hmac(text) is
  'Identidade do documento (H-044, Issue 57): uuid derivado de sha256 do prefixo v1 mais document_hmac, 128 bits. Sem segredo proprio. Reusada por escritoras de access_grant (Issue 62).';

-- 2. Catalogo de auditoria das acoes de trial (audit_event_action_fk). Sem esta linha a auditoria nao grava.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('billing.trial.activated', 'access_grant', false,
   array['type', 'status', 'starts_at', 'ends_at'],
   'Trial de 14 dias ativado pelo profissional (H-044, Issue 57)'),
  ('billing.trial.denied', 'professional_profile', true,
   array[]::text[],
   'Ativacao de trial negada por trial ja usado (H-044, Issue 57)')
on conflict (action, object_type) do nothing;

-- 3. Ativacao (CA-H044-01 a 16; decisoes 268, 269, 273, 275, 499, 501, 509).
-- Ordem: perfil aprovado com document_hmac (for share); trial ja existente da identidade; acesso pago vigente;
-- insercao com on conflict do nothing (corrida fechada pelo indice parcial access_grant_trial_unico).
-- Trial: [p_now, p_now + 336 h), sem source_payment_id. Auditoria na mesma transacao.
create or replace function private.trial_activate(
  p_professional_id uuid,
  p_actor_ref text,
  p_now timestamptz,
  p_correlation_id uuid default null
) returns table (
  out_code text,
  out_grant_id uuid,
  out_starts_at timestamptz,
  out_ends_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_hmac text;
  v_identity uuid;
  v_estado text;
  v_id uuid := null;
  v_fim timestamptz;
begin
  if p_professional_id is null or p_actor_ref is null or p_now is null then
    raise exception 'entrada_invalida' using errcode = '22023';
  end if;
  v_fim := p_now + interval '336 hours';

  -- 1. Aprovacao: lida do perfil, travada (for share) para a decisao de H-039 nao mudar o estado no meio.
  select pp.verification_status, pp.document_hmac into v_status, v_hmac
    from app.professional_profile pp
   where pp.user_id = p_professional_id
     for share;
  if not found or v_status is distinct from 'aprovada' or v_hmac is null then
    return query select 'not_verified'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 2. Identidade do documento (independe do perfil, dec. 497).
  v_identity := private.identity_id_from_document_hmac(v_hmac);

  -- 3. Trial ja existente da identidade (qualquer status, inclusive revogado ou vencido).
  if exists (
    select 1 from billing.access_grant g
     where g.identity_id = v_identity and g.type = 'trial'
  ) then
    perform private.audit_append(
      p_actor_ref, 'profissional', 'billing.trial.denied', 'professional_profile',
      p_professional_id, '{}'::jsonb, '{}'::jsonb, 'trial_used', p_correlation_id);
    return query select 'trial_used'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 4. Acesso pago vigente prevalece (dec. 499): ativa, cancelada com acesso ate o fim do periodo, ou em carencia.
  select ca.estado into v_estado
    from private.commercial_access(p_professional_id, p_now) ca;
  if v_estado in ('ativa', 'cancelada_com_acesso_ate_fim_do_periodo', 'em_carencia') then
    return query select 'paid_access_active'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 5. Insercao. Se outra transacao gravou o trial da identidade primeiro, devolve zero linhas (corrida, CA-H044-07).
  insert into billing.access_grant (professional_id, identity_id, type, starts_at, ends_at, status)
  values (p_professional_id, v_identity, 'trial', p_now, v_fim, 'ativa')
  on conflict (identity_id) where type = 'trial' do nothing
  returning id into v_id;

  if v_id is null then
    perform private.audit_append(
      p_actor_ref, 'profissional', 'billing.trial.denied', 'professional_profile',
      p_professional_id, '{}'::jsonb, '{}'::jsonb, 'trial_used', p_correlation_id);
    return query select 'trial_used'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- 6. Auditoria na mesma transacao. Falha aqui levanta excecao e desfaz o trial. Sem identidade, sem HMAC.
  perform private.audit_append(
    p_actor_ref, 'profissional', 'billing.trial.activated', 'access_grant', v_id,
    '{}'::jsonb,
    jsonb_build_object(
      'type', 'trial',
      'status', 'ativa',
      'starts_at', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'ends_at', to_char(v_fim at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
    null, p_correlation_id);

  return query select 'ok'::text, v_id, p_now, v_fim;
end
$$;

comment on function private.trial_activate(uuid, text, timestamptz, uuid) is
  'Ativacao do trial de 14 dias (H-044, Issue 57). Codigos: ok, not_verified, trial_used, paid_access_active. Grava so pelo dono (security definer).';

-- 4. Privilegios (dec. 277 e 282). A derivacao nao e executavel por papel de aplicacao; so o dono (e trial_activate) a usa.
-- app_api nao executa a ativacao: ela e escrita e passa pela camada de servidor (app_system).
revoke all on function private.identity_id_from_document_hmac(text)
  from public, anon, authenticated, service_role, app_api, app_system;
revoke all on function private.trial_activate(uuid, text, timestamptz, uuid)
  from public, anon, authenticated, service_role, app_api;
grant execute on function private.trial_activate(uuid, text, timestamptz, uuid) to app_system;
