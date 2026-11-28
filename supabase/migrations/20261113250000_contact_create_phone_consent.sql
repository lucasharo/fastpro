-- Issue 46 (H-033) | Opt-in de telefone no pedido: migracao EXPANSIVA (docs/factory/129-DESENHO-H033.md, §4.2).
-- Acrescenta service_request.phone_enc (bytea; cifra AES-256-GCM feita pela API com PHONE_ENC_KEY), as tabelas
-- app.contact_consent e app.contact_reveal_log (contrato do 09 §3.8; a Issue 121 so estende) e as funcoes private.
-- Nenhuma coluna existente muda de tipo; nenhuma funcao da Issue 45 e editada (request_owner_get, request_detail_professional
-- e request_publish_commit_enc continuam como estao). Estado de aceite: private.request_acceptance_active nasce FECHADA
-- (select false) ate a E6 substituir a funcao (decisao 448).
-- Todas as funcoes: security definer, search_path vazio, lock_timeout 5s, erro fixo, nenhuma devolve o telefone em claro.
-- Privilegios: so app_system executa; tabelas sem grant e com RLS forcada e sem politica.
-- Idempotente. Desfazer: supabase/rollbacks/20261113250000_contact_create_phone_consent.down.sql.

-- 0. Guarda de pre-requisito: colunas e funcoes usadas. Sem ela o erro apareceria so na chamada.
do $$
declare
  v_falta text;
begin
  select string_agg(x.s || '.' || x.t || '.' || x.c, ', ') into v_falta
    from (values
      ('app', 'service_request', 'id'),
      ('app', 'service_request', 'customer_user_id'),
      ('app', 'service_request', 'status'),
      ('app', 'service_request', 'acceptance_deadline_at'),
      ('app', 'professional_profile', 'user_id'),
      ('app', 'app_user', 'id')) as x(s, t, c)
   where not exists (
     select 1 from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = x.s and c.relname = x.t and a.attname = x.c and a.attnum > 0 and not a.attisdropped);
  if v_falta is not null or to_regprocedure('private.request_visibility_guard(uuid,timestamptz)') is null then
    raise exception 'contato_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Coluna do telefone cifrado (nula; nenhuma linha existente muda).
alter table app.service_request add column if not exists phone_enc bytea;

alter table app.service_request drop constraint if exists service_request_phone_enc_ck;
alter table app.service_request add constraint service_request_phone_enc_ck
  check (phone_enc is null or (octet_length(phone_enc) between 30 and 128 and get_byte(phone_enc, 0) = 1));

-- 2. Consentimento de contato (09 §3.8, com revoked_reason aditivo, decisao 451).
create table if not exists app.contact_consent (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references app.service_request (id) on delete restrict,
  kind text not null check (kind = 'telefone'),
  scope text not null check (scope in ('todos_participantes', 'profissional')),
  professional_id uuid null references app.professional_profile (user_id) on delete restrict,
  granted_at timestamptz not null,
  granted_via text not null check (granted_via in ('formulario_pedido', 'chat')),
  text_version text not null check (text_version ~ '^v[0-9]{1,3}$'),
  revoked_at timestamptz null,
  revoked_reason text null check (revoked_reason in ('cliente_geral', 'cliente_individual', 'telefone_alterado', 'telefone_apagado')),
  constraint contact_consent_escopo_ck check ((scope = 'profissional') = (professional_id is not null)),
  constraint contact_consent_revogacao_ck check (revoked_at is null or revoked_at >= granted_at),
  constraint contact_consent_motivo_ck check ((revoked_at is null) = (revoked_reason is null)),
  constraint contact_consent_via_ck check (granted_via <> 'formulario_pedido' or scope = 'todos_participantes')
);

create unique index if not exists contact_consent_geral_ativo_uq
  on app.contact_consent (request_id) where scope = 'todos_participantes' and revoked_at is null;
create unique index if not exists contact_consent_profissional_ativo_uq
  on app.contact_consent (request_id, professional_id) where scope = 'profissional' and revoked_at is null;
create index if not exists contact_consent_request_ix on app.contact_consent (request_id);

-- 3. Registro de revelacao (09 §3.8). kind ja aceita 'endereco' para a Issue 121 nao alterar a restricao.
-- Sem coluna de valor: o numero nunca e gravado.
create table if not exists app.contact_reveal_log (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references app.service_request (id) on delete restrict,
  professional_id uuid not null references app.professional_profile (user_id) on delete restrict,
  kind text not null check (kind in ('telefone', 'endereco')),
  consent_id uuid null references app.contact_consent (id) on delete restrict,
  at timestamptz not null
);

create index if not exists contact_reveal_log_pedido_ix on app.contact_reveal_log (request_id, at);
create index if not exists contact_reveal_log_profissional_ix on app.contact_reveal_log (professional_id, at);

alter table app.contact_consent enable row level security;
alter table app.contact_consent force row level security;
alter table app.contact_reveal_log enable row level security;
alter table app.contact_reveal_log force row level security;

revoke all on table app.contact_consent from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;
revoke all on table app.contact_reveal_log from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;

-- 4. Gatilhos de imutabilidade (D-09): consentimento so ganha revogacao, uma vez; registro so recebe insert.
create or replace function private.contact_consent_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.revoked_at is not null
     or new.revoked_at is null
     or new.id is distinct from old.id
     or new.request_id is distinct from old.request_id
     or new.kind is distinct from old.kind
     or new.scope is distinct from old.scope
     or new.professional_id is distinct from old.professional_id
     or new.granted_at is distinct from old.granted_at
     or new.granted_via is distinct from old.granted_via
     or new.text_version is distinct from old.text_version then
    raise exception 'consentimento_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function private.contact_recusa_apagar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'registro_somente_insercao' using errcode = '23514';
end
$$;

create or replace function private.contact_reveal_log_bu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'log_somente_insercao' using errcode = '23514';
end
$$;

drop trigger if exists contact_consent_bu on app.contact_consent;
create trigger contact_consent_bu
  before update on app.contact_consent
  for each row execute function private.contact_consent_bu();

drop trigger if exists contact_consent_bd on app.contact_consent;
create trigger contact_consent_bd
  before delete on app.contact_consent
  for each row execute function private.contact_recusa_apagar();

drop trigger if exists contact_consent_truncate on app.contact_consent;
create trigger contact_consent_truncate
  before truncate on app.contact_consent
  for each statement execute function private.contact_recusa_apagar();

drop trigger if exists contact_reveal_log_bu on app.contact_reveal_log;
create trigger contact_reveal_log_bu
  before update on app.contact_reveal_log
  for each row execute function private.contact_reveal_log_bu();

drop trigger if exists contact_reveal_log_bd on app.contact_reveal_log;
create trigger contact_reveal_log_bd
  before delete on app.contact_reveal_log
  for each row execute function private.contact_recusa_apagar();

drop trigger if exists contact_reveal_log_truncate on app.contact_reveal_log;
create trigger contact_reveal_log_truncate
  before truncate on app.contact_reveal_log
  for each statement execute function private.contact_recusa_apagar();

-- 5. Barreira R9 / CA-13: trocar ou apagar o telefone revoga as liberações ativas, na mesma transacao.
create or replace function private.service_request_phone_au()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone_enc is distinct from old.phone_enc then
    update app.contact_consent c
       set revoked_at = greatest(clock_timestamp(), c.granted_at),
           revoked_reason = case when new.phone_enc is null then 'telefone_apagado' else 'telefone_alterado' end
     where c.request_id = new.id
       and c.revoked_at is null;
  end if;
  return new;
end
$$;

drop trigger if exists service_request_phone_au on app.service_request;
create trigger service_request_phone_au
  after update of phone_enc on app.service_request
  for each row execute function private.service_request_phone_au();

-- 6. Funcoes private (so app_system executa).

-- 6.1 Aceite ativo: FECHADA ate a E6 (decisao 448). A E6 substitui por create or replace.
create or replace function private.request_acceptance_active(p_request_id uuid, p_professional_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false
$$;

-- 6.2 Pedido aberto para contato: nao concluido, nao cancelado e dentro do prazo de aceite (R13, CA-15).
create or replace function private.request_open_for_contact(p_request_id uuid, p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_request_id is null or p_now is null then
    raise exception 'contato_parametro_invalido' using errcode = '22023';
  end if;
  return exists (
    select 1 from app.service_request r
     where r.id = p_request_id
       and r.status not in ('concluido', 'cancelado')
       and r.acceptance_deadline_at > p_now);
end
$$;

-- 6.3 Anexa o telefone cifrado ao pedido do dono (publicacao). Idempotente: ja definido = nada muda.
create or replace function private.request_phone_attach(
  p_user uuid,
  p_request_id uuid,
  p_phone_enc bytea,
  p_grant boolean,
  p_text_version text,
  p_now timestamptz)
returns table (out_state text)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_req app.service_request%rowtype;
begin
  if p_user is null or p_request_id is null or p_phone_enc is null or p_grant is null or p_now is null
     or get_byte(p_phone_enc, 0) <> 1 then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;

  select r.* into v_req from app.service_request r
   where r.id = p_request_id and r.customer_user_id = p_user
   for update;
  if not found then
    return query select 'pedido_inexistente'::text;
    return;
  end if;
  if v_req.phone_enc is not null then
    return query select 'ja_definido'::text;
    return;
  end if;

  update app.service_request set phone_enc = p_phone_enc where id = p_request_id;

  if p_grant then
    insert into app.contact_consent (request_id, kind, scope, professional_id, granted_at, granted_via, text_version)
    values (p_request_id, 'telefone', 'todos_participantes', null, p_now, 'formulario_pedido', p_text_version);
    return query select 'consentimento_ativo'::text;
    return;
  end if;
  return query select 'sem_consentimento'::text;
end
$$;

-- 6.4 Troca ou apagamento do telefone pelo dono. Nao cria consentimento (R9). O gatilho revoga as liberações.
create or replace function private.request_phone_replace(
  p_user uuid,
  p_request_id uuid,
  p_phone_enc bytea,
  p_now timestamptz)
returns table (out_state text)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_user is null or p_request_id is null or p_now is null
     or (p_phone_enc is not null and get_byte(p_phone_enc, 0) <> 1) then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from app.service_request r
                  where r.id = p_request_id and r.customer_user_id = p_user
                  for update) then
    return query select 'pedido_inexistente'::text;
    return;
  end if;
  update app.service_request set phone_enc = p_phone_enc where id = p_request_id;
  if p_phone_enc is null then
    return query select 'apagado'::text;
  else
    return query select 'trocado'::text;
  end if;
end
$$;

-- 6.5 Liberacao individual pelo dono, no chat (CA-11). Exige telefone, pedido aberto e aceite ativo (RF-138).
create or replace function private.contact_consent_grant_professional(
  p_user uuid,
  p_request_id uuid,
  p_professional_id uuid,
  p_text_version text,
  p_now timestamptz)
returns table (out_state text)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_req app.service_request%rowtype;
begin
  if p_user is null or p_request_id is null or p_professional_id is null or p_now is null then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;

  select r.* into v_req from app.service_request r
   where r.id = p_request_id and r.customer_user_id = p_user
   for update;
  if not found then
    return query select 'pedido_inexistente'::text;
    return;
  end if;
  if not private.request_open_for_contact(p_request_id, p_now) then
    return query select 'pedido_fechado'::text;
    return;
  end if;
  if v_req.phone_enc is null then
    return query select 'sem_telefone'::text;
    return;
  end if;
  if not private.request_acceptance_active(p_request_id, p_professional_id) then
    return query select 'sem_aceite'::text;
    return;
  end if;
  if exists (select 1 from app.contact_consent c
              where c.request_id = p_request_id and c.scope = 'todos_participantes' and c.revoked_at is null) then
    return query select 'coberto_pelo_geral'::text;
    return;
  end if;
  if exists (select 1 from app.contact_consent c
              where c.request_id = p_request_id and c.scope = 'profissional'
                and c.professional_id = p_professional_id and c.revoked_at is null) then
    return query select 'ja_liberado'::text;
    return;
  end if;

  insert into app.contact_consent (request_id, kind, scope, professional_id, granted_at, granted_via, text_version)
  values (p_request_id, 'telefone', 'profissional', p_professional_id, p_now, 'chat', p_text_version);
  return query select 'liberado'::text;
end
$$;

-- 6.6 Revogacao pelo dono (CA-09, CA-10). Geral (professional nulo) revoga todas as liberações ativas.
-- Individual revoga so a do profissional; quem so esta coberto pelo geral devolve exige_revogar_geral (decisao 452).
create or replace function private.contact_consent_revoke(
  p_user uuid,
  p_request_id uuid,
  p_professional_id uuid,
  p_now timestamptz)
returns table (out_revoked integer, out_state text)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_n integer := 0;
begin
  if p_user is null or p_request_id is null or p_now is null then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from app.service_request r
                  where r.id = p_request_id and r.customer_user_id = p_user
                  for update) then
    return query select 0, 'pedido_inexistente'::text;
    return;
  end if;

  if p_professional_id is null then
    update app.contact_consent c
       set revoked_at = greatest(p_now, c.granted_at), revoked_reason = 'cliente_geral'
     where c.request_id = p_request_id and c.revoked_at is null;
    get diagnostics v_n = row_count;
    return query select v_n, 'revogado'::text;
    return;
  end if;

  if not exists (select 1 from app.contact_consent c
                  where c.request_id = p_request_id and c.scope = 'profissional'
                    and c.professional_id = p_professional_id and c.revoked_at is null)
     and exists (select 1 from app.contact_consent c
                  where c.request_id = p_request_id and c.scope = 'todos_participantes' and c.revoked_at is null) then
    return query select 0, 'exige_revogar_geral'::text;
    return;
  end if;

  update app.contact_consent c
     set revoked_at = greatest(p_now, c.granted_at), revoked_reason = 'cliente_individual'
   where c.request_id = p_request_id and c.scope = 'profissional'
     and c.professional_id = p_professional_id and c.revoked_at is null;
  get diagnostics v_n = row_count;
  return query select v_n, 'revogado'::text;
end
$$;

-- 6.7 Revelacao ao profissional (D-04). Ordem: visibilidade (#45), pedido aberto, aceite ativo, consentimento e telefone,
-- limite de leituras (decisao 455), depois o registro e o blob. Falha em 1 a 4 = zero linhas.
-- Falha no limite = uma linha com out_limited verdadeiro e blob nulo, sem gravar log.
create or replace function private.contact_reveal_phone(
  p_professional_id uuid,
  p_request_id uuid,
  p_now timestamptz)
returns table (out_phone_enc bytea, out_limited boolean)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_phone bytea;
  v_consent uuid;
  v_recentes_pedido integer;
  v_recentes_profissional integer;
begin
  if p_professional_id is null or p_request_id is null or p_now is null then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;
  if not private.request_visibility_guard(p_professional_id, p_now) then
    return;
  end if;

  select r.phone_enc into v_phone from app.service_request r
   where r.id = p_request_id
   for share;
  if not found or not private.request_open_for_contact(p_request_id, p_now) then
    return;
  end if;
  if not private.request_acceptance_active(p_request_id, p_professional_id) then
    return;
  end if;

  select c.id into v_consent from app.contact_consent c
   where c.request_id = p_request_id and c.kind = 'telefone' and c.revoked_at is null
     and (c.scope = 'todos_participantes' or (c.scope = 'profissional' and c.professional_id = p_professional_id))
   order by case when c.scope = 'profissional' then 0 else 1 end
   limit 1;
  if v_consent is null or v_phone is null then
    return;
  end if;

  select count(*) into v_recentes_pedido from app.contact_reveal_log l
   where l.request_id = p_request_id and l.professional_id = p_professional_id
     and l.at > p_now - interval '10 minutes';
  select count(*) into v_recentes_profissional from app.contact_reveal_log l
   where l.professional_id = p_professional_id
     and l.at > p_now - interval '1 hour';
  if v_recentes_pedido >= 10 or v_recentes_profissional >= 60 then
    return query select null::bytea, true;
    return;
  end if;

  insert into app.contact_reveal_log (request_id, professional_id, kind, consent_id, at)
  values (p_request_id, p_professional_id, 'telefone', v_consent, p_now);
  return query select v_phone, false;
end
$$;

-- 6.8 Disponibilidade para o botao "ver telefone": mesmas conferencias 1 a 4, sem log e sem blob.
create or replace function private.contact_available_professional(
  p_professional_id uuid,
  p_request_id uuid,
  p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_ok boolean;
begin
  if p_professional_id is null or p_request_id is null or p_now is null then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;
  if not private.request_visibility_guard(p_professional_id, p_now) then
    return false;
  end if;
  select (r.phone_enc is not null) into v_ok from app.service_request r
   where r.id = p_request_id
   for share;
  if not coalesce(v_ok, false) or not private.request_open_for_contact(p_request_id, p_now) then
    return false;
  end if;
  if not private.request_acceptance_active(p_request_id, p_professional_id) then
    return false;
  end if;
  return exists (select 1 from app.contact_consent c
                  where c.request_id = p_request_id and c.kind = 'telefone' and c.revoked_at is null
                    and (c.scope = 'todos_participantes' or (c.scope = 'profissional' and c.professional_id = p_professional_id)));
end
$$;

-- 6.9 Estado do pedido para o dono: sem telefone em claro nem blob. Zero linhas se o pedido nao e do dono.
create or replace function private.contact_owner_status(p_user uuid, p_request_id uuid)
returns table (out_phone_present boolean, out_consent_id uuid, out_scope text, out_professional_id uuid,
  out_granted_at timestamptz, out_granted_via text, out_revoked_at timestamptz, out_revoked_reason text)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_user is null or p_request_id is null then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;
  return query
  select (r.phone_enc is not null), c.id, c.scope, c.professional_id, c.granted_at, c.granted_via,
         c.revoked_at, c.revoked_reason
    from app.service_request r
    left join app.contact_consent c on c.request_id = r.id
   where r.id = p_request_id and r.customer_user_id = p_user
   order by c.granted_at nulls first;
end
$$;

-- 6.10 Leitura do proprio telefone pelo dono (republicacao, decisao 454). Sem log de revelacao.
create or replace function private.request_phone_owner_get(p_user uuid, p_request_id uuid)
returns bytea
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  v_phone bytea;
begin
  if p_user is null or p_request_id is null then
    raise exception 'contato_entrada_invalida' using errcode = '22023';
  end if;
  select r.phone_enc into v_phone from app.service_request r
   where r.id = p_request_id and r.customer_user_id = p_user;
  return v_phone;
end
$$;

-- 7. Privilegios: so app_system executa; ninguem mais.
revoke all on function private.request_acceptance_active(uuid, uuid) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_open_for_contact(uuid, timestamptz) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_phone_attach(uuid, uuid, bytea, boolean, text, timestamptz) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_phone_replace(uuid, uuid, bytea, timestamptz) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.contact_consent_grant_professional(uuid, uuid, uuid, text, timestamptz) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.contact_consent_revoke(uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.contact_reveal_phone(uuid, uuid, timestamptz) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.contact_available_professional(uuid, uuid, timestamptz) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.contact_owner_status(uuid, uuid) from public, anon, authenticated, service_role, app_api, app_backup_reader;
revoke all on function private.request_phone_owner_get(uuid, uuid) from public, anon, authenticated, service_role, app_api, app_backup_reader;

grant execute on function private.request_acceptance_active(uuid, uuid) to app_system;
grant execute on function private.request_open_for_contact(uuid, timestamptz) to app_system;
grant execute on function private.request_phone_attach(uuid, uuid, bytea, boolean, text, timestamptz) to app_system;
grant execute on function private.request_phone_replace(uuid, uuid, bytea, timestamptz) to app_system;
grant execute on function private.contact_consent_grant_professional(uuid, uuid, uuid, text, timestamptz) to app_system;
grant execute on function private.contact_consent_revoke(uuid, uuid, uuid, timestamptz) to app_system;
grant execute on function private.contact_reveal_phone(uuid, uuid, timestamptz) to app_system;
grant execute on function private.contact_available_professional(uuid, uuid, timestamptz) to app_system;
grant execute on function private.contact_owner_status(uuid, uuid) to app_system;
grant execute on function private.request_phone_owner_get(uuid, uuid) to app_system;
