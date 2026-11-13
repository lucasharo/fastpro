-- H-017 (Issue #30) | Exclusividade de papeis (docs/factory/101-DESENHO-H017.md, §3; decisoes 136 a 143).
-- Idempotente. Desfazer: supabase/rollbacks/20261112200000_identity_create_role_exclusivity.down.sql.
-- Ordem: (0) verificacao previa, sem DDL: aborta com lista de ids se algum usuario ja viola a matriz
-- (CA-12, decisao 140); (1) app.customer_profile; (2) retroalimentacao de cliente; (3) funcoes;
-- (4) gatilhos; (5) imutabilidade de app_user.auth_user_id (CA-01, decisao 143); (6) acao de auditoria.
-- Nao apaga nem altera dado de usuario. Postura igual a H-011/H-012: RLS habilitada e forcada, sem
-- politicas; so app_system recebe privilegios. Erros de regra: errcode 23514 e mensagem fixa (chave).

-- 0. Verificacao previa (CA-12). Lista so ids opacos de app_user, nunca e-mail, nome ou CPF.
do $$
declare
  v_admin_prof text;
  v_admin_cli  text;
  v_aceite     text := '';
begin
  select coalesce(string_agg(s.user_id::text, ',' order by s.user_id::text), '')
    into v_admin_prof
    from app.admin_staff s
    join app.professional_profile p on p.user_id = s.user_id;

  select coalesce(string_agg(s.user_id::text, ',' order by s.user_id::text), '')
    into v_admin_cli
    from app.admin_staff s
   where exists (select 1 from app.app_session x
                  where x.user_id = s.user_id and x.purpose in ('login', 'publish'));

  -- Aceite ja existente no proprio pedido (so se as tabelas das Ondas 2 e 3 ja existirem).
  if to_regclass('app.acceptance') is not null and to_regclass('app.service_request') is not null then
    execute 'select coalesce(string_agg(distinct a.professional_id::text, '','' order by a.professional_id::text), '''')
               from app.acceptance a
               join app.service_request r on r.id = a.request_id
              where r.customer_user_id = a.professional_id'
      into v_aceite;
  end if;

  if v_admin_prof <> '' or v_admin_cli <> '' or v_aceite <> '' then
    raise exception 'h017_violacao_existente'
      using errcode = '23514',
            detail = format('admin_com_perfil_profissional=[%s]; admin_com_sessao_cliente=[%s]; aceite_proprio=[%s]',
                            v_admin_prof, v_admin_cli, v_aceite);
  end if;
end;
$$;

-- 1. Perfil de cliente (09 §3.1). Existe = a pessoa e cliente. Sem UPDATE/DELETE para app_system:
--    o perfil nao muda de dono nem some (exclusao de conta e da H-040).
create table if not exists app.customer_profile (
  user_id     uuid primary key references app.app_user (id) on delete restrict,
  created_at  timestamptz not null
);

comment on table app.customer_profile is
  'Perfil de cliente (H-017, 09 §3.1). Sem UPDATE e sem DELETE para app_system. Guarda de papel por gatilho.';

alter table app.customer_profile enable row level security;
alter table app.customer_profile force row level security;
revoke all on app.customer_profile from public, anon, authenticated, service_role, app_api;
grant select, insert on app.customer_profile to app_system;

-- 2. Retroalimentacao (uma vez). Cliente = nao admin e (sem perfil profissional ou com sessao de cliente).
--    Roda antes dos gatilhos e depois da verificacao previa, entao um admin com evidencia ja aborta acima.
insert into app.customer_profile (user_id, created_at)
select u.id, u.created_at
  from app.app_user u
 where not exists (select 1 from app.admin_staff s where s.user_id = u.id)
   and (not exists (select 1 from app.professional_profile p where p.user_id = u.id)
        or exists (select 1 from app.app_session x
                    where x.user_id = u.id and x.purpose in ('login', 'publish')))
on conflict (user_id) do nothing;

-- 3. Funcoes. Todas security definer com search_path vazio e nomes qualificados.
-- 3.1 Trava por pessoa (CA-10). Exige read committed: a consulta do gatilho precisa ver o commit concorrente.
create or replace function private.role_excl_lock(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'papel_isolamento_nao_suportado' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fastpro:role_excl:' || p_user::text, 0));
end
$$;

-- 3.2 Cliente nao pode ser admin (decisao 137).
create or replace function private.role_excl_guard_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.role_excl_lock(new.user_id);
  if exists (select 1 from app.admin_staff s where s.user_id = new.user_id) then
    raise exception 'papel_exclusivo_admin_cliente' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 3.3 Profissional nao pode ser admin (decisao 137).
create or replace function private.role_excl_guard_professional()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.role_excl_lock(new.user_id);
  if exists (select 1 from app.admin_staff s where s.user_id = new.user_id) then
    raise exception 'papel_exclusivo_admin_profissional' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 3.4 Admin nao pode ter perfil de cliente nem de profissional (decisao 137; inverso). Em qualquer status.
create or replace function private.role_excl_guard_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.role_excl_lock(new.user_id);
  if exists (select 1 from app.customer_profile c where c.user_id = new.user_id)
     or exists (select 1 from app.professional_profile p where p.user_id = new.user_id) then
    raise exception 'papel_exclusivo_perfil_admin' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 3.5 Chave de papel imutavel: linha de perfil ou de admin nao muda de usuario (evita contornar a regra).
create or replace function private.role_excl_chave_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'papel_chave_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 3.6 Identidade de autenticacao imutavel (CA-01, decisao 143).
create or replace function private.app_user_identidade_imutavel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'app_user_identidade_imutavel' using errcode = '23514';
  end if;
  return new;
end
$$;

-- 3.7 Criacao de perfil de cliente (chamada por ensureCustomer). Devolve ok ou reservado (conta admin).
--     Sem gravar nada no caso reservado; a corrida e capturada pela excecao do gatilho.
create or replace function private.customer_profile_ensure(p_user_id uuid, p_now timestamptz)
returns table (out_status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.role_excl_lock(p_user_id);
  if exists (select 1 from app.admin_staff s where s.user_id = p_user_id) then
    return query select 'reservado'::text;
    return;
  end if;
  if exists (select 1 from app.customer_profile c where c.user_id = p_user_id) then
    return query select 'ok'::text;
    return;
  end if;
  begin
    insert into app.customer_profile (user_id, created_at)
    values (p_user_id, p_now)
    on conflict (user_id) do nothing;
  exception when sqlstate '23514' then
    return query select 'reservado'::text;
    return;
  end;
  return query select 'ok'::text;
end
$$;

-- 3.8 Aceite no proprio pedido (I-19, decisao 142). Funcao de gatilho sem tabela alvo ainda: TG_ARGV[0] e o
--     nome da tabela de pedidos (convertido com ::regclass, sem injecao). A regra nao depende do estado do pedido.
--     Cliente anonimizado (customer_user_id nulo) nao bloqueia: nao ha quem comparar.
create or replace function private.acceptance_not_own_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tabela   regclass;
  v_cliente  uuid;
begin
  v_tabela := TG_ARGV[0]::regclass;
  execute format('select r.customer_user_id from %s r where r.id = $1', v_tabela)
    into v_cliente
    using new.request_id;
  if v_cliente is not null and v_cliente = new.professional_id then
    raise exception 'aceite_proprio_pedido' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function
  private.role_excl_lock(uuid),
  private.role_excl_guard_customer(),
  private.role_excl_guard_professional(),
  private.role_excl_guard_admin(),
  private.role_excl_chave_imutavel(),
  private.app_user_identidade_imutavel(),
  private.customer_profile_ensure(uuid, timestamptz),
  private.acceptance_not_own_request()
  from public, anon, authenticated, service_role, app_api;

grant execute on function private.customer_profile_ensure(uuid, timestamptz) to app_system;

-- 4. Gatilhos. Nome e recriado (drop if exists) para tornar a migracao idempotente.
drop trigger if exists role_excl_cliente on app.customer_profile;
create trigger role_excl_cliente
  before insert on app.customer_profile
  for each row execute function private.role_excl_guard_customer();

drop trigger if exists role_excl_profissional on app.professional_profile;
create trigger role_excl_profissional
  before insert on app.professional_profile
  for each row execute function private.role_excl_guard_professional();

drop trigger if exists role_excl_chave_profissional on app.professional_profile;
create trigger role_excl_chave_profissional
  before update of user_id on app.professional_profile
  for each row execute function private.role_excl_chave_imutavel();

drop trigger if exists role_excl_admin on app.admin_staff;
create trigger role_excl_admin
  before insert on app.admin_staff
  for each row execute function private.role_excl_guard_admin();

drop trigger if exists role_excl_chave_admin on app.admin_staff;
create trigger role_excl_chave_admin
  before update of user_id on app.admin_staff
  for each row execute function private.role_excl_chave_imutavel();

drop trigger if exists app_user_identidade_imutavel on app.app_user;
create trigger app_user_identidade_imutavel
  before update of auth_user_id on app.app_user
  for each row execute function private.app_user_identidade_imutavel();

-- 5. Auditoria da recusa (decisao 141, CA-11). So o codigo da regra; o ator e o proprio usuario.
insert into audit.action_catalog (action, object_type, reason_required, state_keys, description)
values ('identity.role_exclusivity.denied', 'app_user', false, array['rule'],
        'Operacao recusada pela exclusividade de papeis (H-017); so o codigo da regra')
on conflict (action, object_type) do nothing;
