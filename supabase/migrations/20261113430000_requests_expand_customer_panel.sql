-- Issue 47 (H-034) | Painel do cliente: indice e funcao de lista do dono (docs/factory/133-DESENHO-H034.md, §3).
-- Expansiva: um indice e uma funcao private nova. Nao altera coluna, tabela, dado, a funcao de detalhe da Issue 45
-- (private.request_owner_get) nem o indice antigo (customer_user_id, status). Sem leitura de endereco nem de contato.
-- A lista devolve so as colunas de saida fechadas (CA-16). O prazo e calculado com o relogio injetado (p_now).
-- Idempotente. Desfazer: supabase/rollbacks/20261113430000_requests_expand_customer_panel.down.sql.

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'app' and table_name = 'service_request'
         and column_name in ('id', 'customer_user_id', 'service_id', 'status', 'published_at', 'acceptance_deadline_at')) <> 6
     or not exists (select 1 from information_schema.columns
       where table_schema = 'app' and table_name = 'service' and column_name = 'name')
  then
    raise exception 'painel_pre_requisito_ausente';
  end if;
end
$$;

create index if not exists service_request_cliente_recente_idx
  on app.service_request (customer_user_id, published_at desc, id desc);

drop function if exists private.request_list_owner(uuid, timestamptz, timestamptz, uuid, integer);

create function private.request_list_owner(p_user uuid, p_now timestamptz, p_after_published_at timestamptz,
  p_after_id uuid, p_limit integer)
returns table (out_id uuid, out_service_name text, out_status text, out_deadline_state text,
  out_published_at timestamptz, out_deadline_at timestamptz, out_cursor_ts text)
language plpgsql
stable
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
begin
  if p_user is null or p_now is null then
    raise exception 'leitura_entrada_invalida' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 21 then
    raise exception 'limite_invalido' using errcode = '22023';
  end if;
  if (p_after_published_at is null) <> (p_after_id is null) then
    raise exception 'cursor_invalido' using errcode = '22023';
  end if;
  return query
    select r.id,
           s.name::text,
           r.status::text,
           case when r.status <> 'publicado' then null
                when p_now < r.acceptance_deadline_at then 'aberto'
                else 'encerrado' end,
           r.published_at,
           r.acceptance_deadline_at,
           to_char(r.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      from app.service_request r
      join app.service s on s.id = r.service_id
     where r.customer_user_id = p_user
       and (p_after_published_at is null
            or (r.published_at, r.id) < (p_after_published_at, p_after_id))
     order by r.published_at desc, r.id desc
     limit p_limit;
end
$$;

revoke all on function private.request_list_owner(uuid, timestamptz, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role, app_api, app_backup_reader;
grant execute on function private.request_list_owner(uuid, timestamptz, timestamptz, uuid, integer) to app_system;
