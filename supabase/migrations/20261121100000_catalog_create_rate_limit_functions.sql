-- Issue 156 (F6) | Limite de taxa da busca de servico (H-019) executavel pelo login da API.
-- Causa: o login da API (app_api) nao tinha EXECUTE em private.rl_check e private.rl_hit, e nao tinha
-- USAGE no esquema ops (ops.rate_counter). A busca falhava e a rota devolvia 503 fixo.
-- Decisao do lider (Issue 156): duas funcoes privadas SECURITY DEFINER com search_path vazio que
-- delegam para private.rl_check e private.rl_hit (mesmo padrao de private.audit_query_rate_take).
-- Somente app_api executa. Nenhum privilegio direto em ops ou em tabelas e concedido a app_api.
-- A chave recebida da aplicacao e 'catalog_search:' + HMAC do IP (o prefixo e exigido aqui). Antes de
-- gravar, a funcao a converte em sha256 em hex (64 caracteres), o formato exigido por ops.rate_counter.
-- O IP nunca chega ao banco em claro. Idempotente.
-- Desfazer: supabase/rollbacks/20261121100000_catalog_create_rate_limit_functions.down.sql

create or replace function private.catalog_rate_check(
  p_key text,
  p_span_s integer,
  p_bucket_s integer,
  p_limit integer,
  p_now timestamptz)
returns table (out_ok boolean, out_retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_key is null or not starts_with(p_key, 'catalog_search:') then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;
  v_key := encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  return query
    select r.out_ok, r.out_retry_after
      from private.rl_check(v_key, p_span_s, p_bucket_s, p_limit, p_now) r;
end
$$;

create or replace function private.catalog_rate_hit(
  p_key text,
  p_bucket_s integer,
  p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_key is null or not starts_with(p_key, 'catalog_search:') then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;
  v_key := encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  perform private.rl_hit(v_key, p_bucket_s, p_now);
end
$$;

comment on function private.catalog_rate_check(text, integer, integer, integer, timestamptz) is
  'Limite de taxa da busca de servico (H-019, Issue 156). Converte a chave catalog_search: em sha256 hex e delega a private.rl_check. EXECUTE so para app_api.';
comment on function private.catalog_rate_hit(text, integer, timestamptz) is
  'Conta a busca aceita (H-019, Issue 156). Converte a chave catalog_search: em sha256 hex e delega a private.rl_hit. EXECUTE so para app_api.';

revoke all on function
  private.catalog_rate_check(text, integer, integer, integer, timestamptz),
  private.catalog_rate_hit(text, integer, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  private.catalog_rate_check(text, integer, integer, integer, timestamptz),
  private.catalog_rate_hit(text, integer, timestamptz)
  to app_api;
