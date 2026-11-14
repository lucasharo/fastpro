-- Issue 55 (H-042), parte A | Guarda unica de elegibilidade do profissional (docs/factory/142-DESENHO-H042.md, §3 e §4).
-- Decisoes 563, 565 a 568, 571, 573, 575, 577, 578 (Rodada 121) e 640 a 643 (Rodada 123).
-- Cria private.professional_access_guard(uuid, text, timestamptz): unico lugar com a regra de elegibilidade.
--   modo 'descoberta_aceite': professional_eligible (aprovada, conta ativa, e-mail verificado) e acesso comercial vigente.
--   modo 'participacao': professional_eligible; nao exige acesso vigente.
-- Fail closed: qualquer nulo, modo desconhecido, erro interno ou estado fora da lista = false. Nunca levanta excecao.
-- Troca o corpo de private.request_visibility_guard (mesma assinatura) para delegar a guarda (fachada da #45 e da #46).
-- discover_requests ganha p_now (sexto parametro, com default) e a guarda no inicio; a versao de 5 argumentos sai
-- na mesma migracao. discover_scan, professional_eligible e commercial_access nao mudam.
-- Idempotente. Sem alteracao de tabela, dado, cron ou grant de tabela.

-- 0. Pre-requisitos: as funcoes que esta migracao usa e troca precisam existir.
do $$
begin
  if to_regprocedure('private.professional_eligible(uuid)') is null
     or to_regprocedure('private.commercial_access(uuid,timestamp with time zone)') is null
     or to_regprocedure('private.request_visibility_guard(uuid,timestamp with time zone)') is null
     or to_regprocedure('private.discover_scan(uuid,double precision,double precision,integer,integer,smallint,integer,uuid,timestamp with time zone)') is null
     or to_regprocedure('private.discover_requests(uuid,integer,smallint,integer,uuid)') is null then
    raise exception 'guarda_pre_requisito_ausente';
  end if;
end
$$;

-- 1. Guarda unica. Lista de permissao de estados de acesso (decisao 577); negacao por padrao.
create or replace function private.professional_access_guard(
  p_professional_id uuid,
  p_mode            text,
  p_now             timestamp with time zone)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_estado text;
begin
  if p_professional_id is null or p_mode is null or p_now is null then
    return false;
  end if;
  if p_mode not in ('descoberta_aceite', 'participacao') then
    return false;
  end if;
  if not private.professional_eligible(p_professional_id) then
    return false;
  end if;
  if p_mode = 'participacao' then
    return true;
  end if;
  select c.estado
    into v_estado
    from private.commercial_access(p_professional_id, p_now) c;
  return coalesce(v_estado in ('trial_ativo', 'ativa', 'cancelada_com_acesso_ate_fim_do_periodo', 'em_carencia'), false);
exception
  when others then
    return false;
end
$$;

revoke all on function private.professional_access_guard(uuid, text, timestamp with time zone)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.professional_access_guard(uuid, text, timestamp with time zone) to app_system;

-- 2. Fachada da #45 e da #46: mesma assinatura e mesmo retorno. Parametro nulo continua com 22023 (decisao 643).
create or replace function private.request_visibility_guard(p_professional_id uuid, p_now timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_professional_id is null or p_now is null then
    raise exception 'visibilidade_parametro_invalido' using errcode = '22023';
  end if;
  return private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now);
end
$$;

revoke all on function private.request_visibility_guard(uuid, timestamptz)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.request_visibility_guard(uuid, timestamptz) to app_system;

-- 3. Entrada da descoberta: 6 argumentos, p_now com default (decisao 641). A versao de 5 argumentos sai agora.
drop function if exists private.discover_requests(uuid, integer, smallint, integer, uuid);

create function private.discover_requests(
  p_professional_id uuid,
  p_limit           integer default 50,
  p_after_group     smallint default null,
  p_after_key       integer default null,
  p_after_id        uuid default null,
  p_now             timestamp with time zone default now())
returns table (out_request_id uuid, out_cursor_group smallint, out_cursor_key integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lon   double precision;
  v_lat   double precision;
  v_raio  integer;
begin
  -- Guarda antes de ler a base: negado devolve o mesmo conjunto vazio de profissional sem pedido (CA-H042-07).
  if not private.professional_access_guard(p_professional_id, 'descoberta_aceite', p_now) then
    return;
  end if;

  select g.match_lon, g.match_lat, pa.radius_m
    into v_lon, v_lat, v_raio
    from app.professional_area pa
    join app.geocode_point g on g.id = pa.geocode_point_id
   where pa.professional_id = p_professional_id
     and g.subject_kind = 'professional_base'
     and g.state = 'ok'
     and g.match_grid_version = 1;

  return query
    select d.out_request_id, d.out_cursor_group, d.out_cursor_key
      from private.discover_scan(p_professional_id, v_lon, v_lat, v_raio, p_limit,
                                 p_after_group, p_after_key, p_after_id, p_now) d;
end
$$;

revoke all on function private.discover_requests(uuid, integer, smallint, integer, uuid, timestamp with time zone)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.discover_requests(uuid, integer, smallint, integer, uuid, timestamp with time zone) to app_system;
