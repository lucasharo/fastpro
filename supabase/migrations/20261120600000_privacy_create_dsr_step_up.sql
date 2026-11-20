-- Issue 120 (H-111) | Step-up do titular para abrir acesso e eliminacao (147-DESENHO-H111 §3.2, §4.1, §5.1, §6.1; P-A).
-- Expansiva: uma tabela nova (app.dsr_step_up_code), quatro funcoes (emitir, confirmar, selar para envio e leitura do
-- estado), configuracao privacy.dsr_step_up_* e acoes de auditoria. Nenhuma tabela existente e alterada, e
-- app.step_up_grant (fatia 2) e reaproveitado sem mudanca de esquema.
-- Desenho do codigo: 6 digitos, so o HMAC (pepper do servidor, calculado na API) fica no banco, mais o blob cifrado
-- (AES-GCM, chave AUTH_CHALLENGE_KEY, AAD "dsr1|<id>|code_enc") que o envio precisa para montar o e-mail. Esse blob
-- e apagado (nulo) ao consumir ou invalidar o codigo. Tentativas: 5 por codigo, depois bloqueio temporario de 15 min
-- (privacy.dsr_step_up_lock_minutes) que tambem barra nova emissao. Emissao: 3 por hora por titular
-- (privacy.dsr_step_up_max_per_hour). Validade do codigo: 10 min (privacy.dsr_step_up_code_minutes). Valores
-- [PROPOSTA] do desenho; ficam em ops.app_config para ajuste sem migracao.
-- O e-mail entra em ops.email_outbox com tipo proprio dsr_stepup (categoria acesso, classe auth). O envio real segue o
-- pipeline e a cota existentes; nada e enviado por esta migracao.
-- Desfazer: supabase/rollbacks/20261120600000_privacy_create_dsr_step_up.down.sql (recusa se houver codigo).

do $$
begin
  if to_regclass('app.app_user') is null
     or to_regclass('app.step_up_grant') is null
     or to_regclass('ops.email_outbox') is null
     or to_regclass('ops.app_config') is null
     or not exists (select 1 from pg_roles where rolname = 'app_system')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'private' and p.proname = 'dsr_config_inteiro')
     or not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'private' and p.proname = 'email_outbox_inserir')
  then
    raise exception 'dsr_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Configuracao (valores [PROPOSTA]; so insere o que falta) --------------------------------------------------------
insert into ops.app_config (key, value, version, updated_by)
select v.key, v.value, 1, 'migration:20261120600000'
  from (values
    ('privacy.dsr_step_up_code_minutes', '10'::jsonb),
    ('privacy.dsr_step_up_max_attempts', '5'::jsonb),
    ('privacy.dsr_step_up_lock_minutes', '15'::jsonb),
    ('privacy.dsr_step_up_max_per_hour', '3'::jsonb)
  ) as v (key, value)
 where not exists (select 1 from ops.app_config c where c.key = v.key);

-- 2. Codigo de step-up do titular --------------------------------------------------------------------------------------
create table if not exists app.dsr_step_up_code (
  id            uuid primary key,
  user_id       uuid not null references app.app_user (id) on delete restrict,
  code_hmac     text not null
                  constraint dsr_step_up_code_hmac_check check (code_hmac ~ '^[0-9a-f]{64}$'),
  code_enc      bytea,
  outbox_id     uuid references ops.email_outbox (id) on delete restrict,
  attempts      integer not null default 0
                  constraint dsr_step_up_code_tentativas_check check (attempts >= 0),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  locked_until  timestamptz,
  consumed_at   timestamptz,
  invalidated_at timestamptz,
  constraint dsr_step_up_code_validade_check check (expires_at > created_at),
  constraint dsr_step_up_code_uso_check check (consumed_at is null or invalidated_at is null)
);

create index if not exists dsr_step_up_code_usuario_idx on app.dsr_step_up_code (user_id, created_at desc);

comment on table app.dsr_step_up_code is
  'Codigo de 6 digitos do step-up do titular (Issue 120, H-111). So HMAC e blob cifrado; sem exclusao.';

alter table app.dsr_step_up_code enable row level security;
alter table app.dsr_step_up_code force row level security;
revoke all on app.dsr_step_up_code from public, anon, authenticated, app_api;

-- Imutabilidade: identidade, HMAC, validade e prazos nunca mudam. Tentativas so sobem. Consumo e invalidacao uma vez.
-- O blob cifrado so pode ser apagado (nulo), nunca trocado.
create or replace function private.dsr_step_up_code_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.code_hmac is distinct from old.code_hmac
     or new.outbox_id is distinct from old.outbox_id
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'dsr_step_up_code_imutavel' using errcode = '42501';
  end if;
  if new.code_enc is distinct from old.code_enc and new.code_enc is not null then
    raise exception 'dsr_step_up_code_imutavel' using errcode = '42501';
  end if;
  if new.attempts < old.attempts then
    raise exception 'dsr_step_up_code_tentativas_regressivas' using errcode = '42501';
  end if;
  if old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at then
    raise exception 'dsr_step_up_code_ja_consumido' using errcode = '42501';
  end if;
  if old.invalidated_at is not null and new.invalidated_at is distinct from old.invalidated_at then
    raise exception 'dsr_step_up_code_ja_invalidado' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists dsr_step_up_code_guard on app.dsr_step_up_code;
create trigger dsr_step_up_code_guard
  before update on app.dsr_step_up_code
  for each row execute function private.dsr_step_up_code_guard();

drop trigger if exists dsr_step_up_code_no_delete on app.dsr_step_up_code;
create trigger dsr_step_up_code_no_delete
  before delete or truncate on app.dsr_step_up_code
  for each statement execute function private.dsr_registro_refuse_delete();

-- 3. Catalogo de auditoria (acoes desta fatia) ------------------------------------------------------------------------
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description) values
  ('dsr.step_up_issued', 'app_user', false, array[]::text[],
   'Codigo de step-up do direito do titular emitido (H-111); sem o codigo'),
  ('dsr.step_up_confirmed', 'app_user', false, array[]::text[],
   'Step-up do direito do titular confirmado; grant de uso unico criado (H-111)'),
  ('dsr.step_up_locked', 'app_user', false, array[]::text[],
   'Step-up do direito do titular bloqueado apos tentativas (H-111)')
on conflict (action, object_type) do nothing;

-- 4. app.dsr_step_up_issue: emite o codigo e enfileira o e-mail (limite de 3 por hora; sem envio direto) ---------------
-- Retornos: criado (outbox_id), limite (retry_after), bloqueado (retry_after), negado (conta sem status ativo).
create or replace function app.dsr_step_up_issue(
  p_user uuid,
  p_code_id uuid,
  p_code_hmac text,
  p_code_enc bytea
)
returns table (
  out_resultado text,
  out_outbox_id uuid,
  out_retry_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_minutos integer;
  v_max_hora integer;
  v_recentes integer;
  v_antigo timestamptz;
  v_bloqueado_ate timestamptz;
  v_saida uuid;
begin
  if p_user is null or p_code_id is null or p_code_hmac is null or p_code_enc is null then
    raise exception 'dsr_step_up_entrada_invalida' using errcode = '22023';
  end if;

  if not exists (select 1 from app.app_user u where u.id = p_user and u.status = 'ativo') then
    return query select 'negado'::text, null::uuid, null::integer;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dsr_step_up:' || p_user::text, 0));

  -- Bloqueio temporario vigente bloqueia tambem a nova emissao.
  select c.locked_until into v_bloqueado_ate
    from app.dsr_step_up_code c
   where c.user_id = p_user
   order by c.created_at desc
   limit 1;
  if v_bloqueado_ate is not null and v_bloqueado_ate > v_agora then
    return query select 'bloqueado'::text, null::uuid,
      greatest(1, ceil(extract(epoch from (v_bloqueado_ate - v_agora)))::integer);
    return;
  end if;

  v_max_hora := private.dsr_config_inteiro('privacy.dsr_step_up_max_per_hour');
  select count(*)::integer into v_recentes
    from app.dsr_step_up_code c
   where c.user_id = p_user
     and c.created_at > v_agora - interval '1 hour';
  if v_recentes >= v_max_hora then
    select c.created_at into v_antigo
      from app.dsr_step_up_code c
     where c.user_id = p_user
       and c.created_at > v_agora - interval '1 hour'
     order by c.created_at
     offset (v_recentes - v_max_hora)
     limit 1;
    return query select 'limite'::text, null::uuid,
      greatest(1, ceil(extract(epoch from (v_antigo + interval '1 hour' - v_agora)))::integer);
    return;
  end if;

  -- Um codigo novo invalida o anterior vivo do mesmo titular.
  update app.dsr_step_up_code c
     set invalidated_at = v_agora,
         code_enc = null
   where c.user_id = p_user
     and c.consumed_at is null
     and c.invalidated_at is null
     and c.expires_at > v_agora;

  v_minutos := private.dsr_config_inteiro('privacy.dsr_step_up_code_minutes');
  insert into app.dsr_step_up_code (id, user_id, code_hmac, code_enc, attempts, created_at, expires_at)
  values (p_code_id, p_user, p_code_hmac, p_code_enc, 0, v_agora, v_agora + make_interval(mins => v_minutos));

  -- Saida do e-mail: classe auth, tipo proprio dsr_stepup, so a referencia do codigo (nunca o codigo).
  select e.out_outbox_id into v_saida
    from private.email_outbox_inserir(p_user, 'acesso', 'auth', 'dsr_stepup', 'dsr_stepup',
           jsonb_build_object('challenge_ref', p_code_id), 'dsrstp:' || p_code_id::text, v_agora) e;

  update app.dsr_step_up_code c
     set outbox_id = v_saida
   where c.id = p_code_id;

  perform private.audit_append('system:dsr_step_up', 'system', 'dsr.step_up_issued', 'app_user', p_user,
    '{}'::jsonb, '{}'::jsonb, null, null);

  return query select 'criado'::text, v_saida, null::integer;
end
$$;

-- 5. app.dsr_step_up_confirm: troca o codigo pelo grant de uso unico (app.step_up_grant, purpose dsr_open) -------------
-- Retornos: ok (expires_at), invalido (codigo errado, vencido, consumido ou sem codigo), bloqueado (retry_after),
-- negado (conta sem status ativo). O hash do token chega da API; o token em claro nunca entra no banco.
create or replace function app.dsr_step_up_confirm(
  p_user uuid,
  p_code_hmac text,
  p_grant_hash text
)
returns table (
  out_resultado text,
  out_expires_at timestamptz,
  out_retry_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agora timestamptz := now();
  v_c record;
  v_tentativas integer;
  v_max integer;
  v_bloqueio integer;
  v_validade timestamptz;
begin
  if p_user is null or p_code_hmac is null or p_grant_hash is null then
    raise exception 'dsr_step_up_entrada_invalida' using errcode = '22023';
  end if;

  if not exists (select 1 from app.app_user u where u.id = p_user and u.status = 'ativo') then
    return query select 'negado'::text, null::timestamptz, null::integer;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dsr_step_up:' || p_user::text, 0));

  select * into v_c
    from app.dsr_step_up_code c
   where c.user_id = p_user
   order by c.created_at desc
   limit 1
     for update;
  if not found then
    return query select 'invalido'::text, null::timestamptz, null::integer;
    return;
  end if;

  if v_c.locked_until is not null and v_c.locked_until > v_agora then
    return query select 'bloqueado'::text, null::timestamptz,
      greatest(1, ceil(extract(epoch from (v_c.locked_until - v_agora)))::integer);
    return;
  end if;

  if v_c.consumed_at is not null or v_c.invalidated_at is not null or v_c.expires_at <= v_agora then
    return query select 'invalido'::text, null::timestamptz, null::integer;
    return;
  end if;

  if v_c.code_hmac = p_code_hmac then
    update app.dsr_step_up_code c
       set consumed_at = v_agora,
           code_enc = null
     where c.id = v_c.id;

    v_validade := v_agora + make_interval(mins => private.dsr_config_inteiro('privacy.dsr_step_up_minutes'));
    insert into app.step_up_grant (user_id, purpose, token_hash, created_at, expires_at)
    values (p_user, 'dsr_open', p_grant_hash, v_agora, v_validade);

    perform private.audit_append('system:dsr_step_up', 'system', 'dsr.step_up_confirmed', 'app_user', p_user,
      '{}'::jsonb, '{}'::jsonb, null, null);

    return query select 'ok'::text, v_validade, null::integer;
    return;
  end if;

  v_max := private.dsr_config_inteiro('privacy.dsr_step_up_max_attempts');
  v_tentativas := v_c.attempts + 1;
  if v_tentativas >= v_max then
    v_bloqueio := private.dsr_config_inteiro('privacy.dsr_step_up_lock_minutes');
    update app.dsr_step_up_code c
       set attempts = v_tentativas,
           invalidated_at = v_agora,
           code_enc = null,
           locked_until = v_agora + make_interval(mins => v_bloqueio)
     where c.id = v_c.id;

    perform private.audit_append('system:dsr_step_up', 'system', 'dsr.step_up_locked', 'app_user', p_user,
      '{}'::jsonb, '{}'::jsonb, null, null);

    return query select 'bloqueado'::text, null::timestamptz, v_bloqueio * 60;
    return;
  end if;

  update app.dsr_step_up_code c
     set attempts = v_tentativas
   where c.id = v_c.id;

  return query select 'invalido'::text, null::timestamptz, null::integer;
end
$$;

-- 6. app.dsr_step_up_code_sealed: entrega ao envio o blob cifrado enquanto o codigo estiver vivo ----------------------
-- Sem linha viva (consumido, invalidado, vencido ou apagado) devolve nada; o envio recusa com codigo fixo.
create or replace function app.dsr_step_up_code_sealed(p_code uuid)
returns table (
  out_code_enc bytea
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select c.code_enc
      from app.dsr_step_up_code c
     where c.id = p_code
       and c.consumed_at is null
       and c.invalidated_at is null
       and c.expires_at > now()
       and c.code_enc is not null;
end
$$;

-- 7. Permissoes: so app_system executa as funcoes da API ------------------------------------------------------------
revoke all on function
  app.dsr_step_up_issue(uuid, uuid, text, bytea),
  app.dsr_step_up_confirm(uuid, text, text),
  app.dsr_step_up_code_sealed(uuid)
  from public, anon, authenticated, app_api;

grant execute on function
  app.dsr_step_up_issue(uuid, uuid, text, bytea),
  app.dsr_step_up_confirm(uuid, text, text),
  app.dsr_step_up_code_sealed(uuid)
  to app_system;
