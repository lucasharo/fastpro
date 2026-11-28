-- Notificacoes push (decisao do dono, 2026-11-27): web (Web Push), Android e iOS (Expo). Um aparelho por linha; o
-- envio nasce de cada item novo do pipeline de avisos (ops.notification_item), por um job 'push.send' que carrega so
-- o id do item. Tabela fechada: tudo passa por funcoes security definer do papel app_system.

create table if not exists app.push_device (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app.app_user (id) on delete cascade,
  platform     text not null check (platform in ('web','android','ios')),
  -- web: endpoint do servico de push do navegador; android e ios: token do Expo.
  token        text not null unique check (length(token) between 1 and 1000),
  p256dh       text check (length(p256dh) between 1 and 200),
  auth         text check (length(auth) between 1 and 100),
  created_at   timestamptz not null,
  last_seen_at timestamptz not null,
  constraint push_device_chaves_consistentes
    check ((platform = 'web') = (p256dh is not null) and (platform = 'web') = (auth is not null))
);

create index if not exists push_device_dono_idx on app.push_device (user_id, last_seen_at desc);

alter table app.push_device enable row level security;
alter table app.push_device force row level security;
revoke all on table app.push_device from public, anon, authenticated, service_role, app_api, app_backup_reader, app_system;

-- Registra (ou renova) o aparelho. O mesmo token passa para a conta atual. Teto de 10 aparelhos por conta.
create or replace function private.push_device_register(
  p_user uuid, p_platform text, p_token text, p_p256dh text, p_auth text, p_now timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_user is null or p_platform is null or p_token is null or p_now is null then
    raise exception 'push_entrada_invalida' using errcode = '22023';
  end if;
  if not exists (select 1 from app.app_user u where u.id = p_user and u.status = 'ativo') then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('push_device:' || p_user::text));
  insert into app.push_device (user_id, platform, token, p256dh, auth, created_at, last_seen_at)
  values (p_user, p_platform, p_token, p_p256dh, p_auth, p_now, p_now)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, p256dh = excluded.p256dh,
        auth = excluded.auth, last_seen_at = excluded.last_seen_at;
  delete from app.push_device d
   where d.user_id = p_user
     and d.id not in (select x.id from app.push_device x where x.user_id = p_user
                       order by x.last_seen_at desc, x.id limit 10);
  return true;
end
$$;

create or replace function private.push_device_remove(p_user uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.push_device d where d.user_id = p_user and d.token = p_token;
  return found;
end
$$;

-- Token recusado em definitivo pelo servico de push (aparelho desinstalado, inscricao vencida).
create or replace function private.push_device_discard(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from app.push_device d where d.token = p_token
$$;

-- Aparelhos a avisar por um item do pipeline. Item descartado ou conta inativa: nada.
create or replace function private.push_item_targets(p_item uuid)
returns table (out_email_type text, out_scope_key text, out_platform text, out_token text, out_p256dh text, out_auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.email_type, i.scope_key, d.platform, d.token, d.p256dh, d.auth
    from ops.notification_item i
    join app.app_user u on u.id = i.recipient_user_id and u.status = 'ativo'
    join app.push_device d on d.user_id = u.id
   where i.id = p_item and i.state <> 'descartado'
   order by d.last_seen_at desc, d.id
$$;

-- Conta que deixa de estar ativa (bloqueio, exclusao) perde os aparelhos.
create or replace function private.push_device_conta_inativa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from app.push_device d where d.user_id = new.id;
  return null;
end
$$;

drop trigger if exists push_device_conta_inativa on app.app_user;
create trigger push_device_conta_inativa
  after update of status on app.app_user
  for each row when (new.status is distinct from 'ativo')
  execute function private.push_device_conta_inativa();

-- Item novo de aceite, escolha ou cancelamento, de quem tem aparelho: enfileira o push (uma vez por item).
create or replace function private.notification_item_enfileira_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from app.push_device d where d.user_id = new.recipient_user_id) then
    perform private.job_enqueue('push.send', 'push.send:' || new.id::text, clock_timestamp(), new.id::text, 3);
  end if;
  return null;
end
$$;

drop trigger if exists notification_item_push on ops.notification_item;
create trigger notification_item_push
  after insert on ops.notification_item
  for each row when (new.category in ('aceite','selecao','cancelamento'))
  execute function private.notification_item_enfileira_push();

revoke all on function private.push_device_register(uuid, text, text, text, text, timestamptz) from public, anon, authenticated, service_role, app_api;
revoke all on function private.push_device_remove(uuid, text) from public, anon, authenticated, service_role, app_api;
revoke all on function private.push_device_discard(text) from public, anon, authenticated, service_role, app_api;
revoke all on function private.push_item_targets(uuid) from public, anon, authenticated, service_role, app_api;
revoke all on function private.push_device_conta_inativa() from public, anon, authenticated, service_role, app_api;
revoke all on function private.notification_item_enfileira_push() from public, anon, authenticated, service_role, app_api;
grant execute on function private.push_device_register(uuid, text, text, text, text, timestamptz) to app_system;
grant execute on function private.push_device_remove(uuid, text) to app_system;
grant execute on function private.push_device_discard(text) to app_system;
grant execute on function private.push_item_targets(uuid) to app_system;
