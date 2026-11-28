-- Issue 156 | Limite de taxa do rascunho sem conta (H-025) executavel pelo login da API (app_api).
-- Causa: o rascunho chama private.rl_check e private.rl_hit (PgDraftRate.check/hit) antes de criar o
-- rascunho. O login app_api nao tinha EXECUTE nessas funcoes (so app_system). A criacao falhava com 42501
-- e a rota devolvia 503 fixo, sem detalhe.
-- Mesmo padrao de private.catalog_rate_check/catalog_rate_hit (20261121100000): duas funcoes SECURITY DEFINER
-- com search_path vazio que delegam para private.rl_check e private.rl_hit. Somente app_api executa.
-- Nenhum privilegio direto em ops ou em tabelas e concedido a app_api.
-- A chave chega ja em 64 caracteres hexadecimais: a aplicacao calcula o sha256 (PgDraftRate.chave), e a
-- funcao recusa qualquer outro formato. O IP e o segredo nunca chegam ao banco em claro. Idempotente.
-- Desfazer: supabase/rollbacks/20261121110000_draft_create_rate_limit_functions.down.sql

create or replace function private.draft_rate_check(
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
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;
  return query
    select r.out_ok, r.out_retry_after
      from private.rl_check(p_key, p_span_s, p_bucket_s, p_limit, p_now) r;
end
$$;

create or replace function private.draft_rate_hit(
  p_key text,
  p_bucket_s integer,
  p_now timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'rate_entrada_invalida' using errcode = '22023';
  end if;
  perform private.rl_hit(p_key, p_bucket_s, p_now);
end
$$;

comment on function private.draft_rate_check(text, integer, integer, integer, timestamptz) is
  'Limite de taxa do rascunho sem conta (H-025, Issue 156). Valida a chave em hex de 64 e delega a private.rl_check. EXECUTE so para app_api.';
comment on function private.draft_rate_hit(text, integer, timestamptz) is
  'Conta o rascunho aceito (H-025, Issue 156). Valida a chave em hex de 64 e delega a private.rl_hit. EXECUTE so para app_api.';

revoke all on function
  private.draft_rate_check(text, integer, integer, integer, timestamptz),
  private.draft_rate_hit(text, integer, timestamptz)
  from public, anon, authenticated, service_role;

grant execute on function
  private.draft_rate_check(text, integer, integer, integer, timestamptz),
  private.draft_rate_hit(text, integer, timestamptz)
  to app_api;
